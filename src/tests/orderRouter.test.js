jest.mock('../database/database.js', () => ({
  Role: {
    Diner: 'diner',
    Franchisee: 'franchisee',
    Admin: 'admin',
  },
  DB: {
    isLoggedIn: jest.fn(),
    getMenu: jest.fn(),
    addMenuItem: jest.fn(),
    getOrders: jest.fn(),
    addDinerOrder: jest.fn(),
  },
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../config.js');
const app = require('../service.js');
const { DB, Role } = require('../database/database.js');

const originalFetch = global.fetch;
let server;

const diner = {
  id: 17,
  name: 'Test Diner',
  email: 'diner@test.com',
  roles: [{ role: Role.Diner }],
};

const admin = {
  id: 1,
  name: 'Test Admin',
  email: 'admin@test.com',
  roles: [{ role: Role.Admin }],
};

function tokenFor(user) {
  return jwt.sign(user, config.jwtSecret);
}

function authenticated(requestBuilder, user = diner) {
  return requestBuilder.set('Authorization', `Bearer ${tokenFor(user)}`);
}

beforeAll(async () => {
  server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  DB.isLoggedIn.mockResolvedValue(true);
  global.fetch = jest.fn();
});

afterAll(async () => {
  global.fetch = originalFetch;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('GET /api/order/menu', () => {
  test('returns the menu without requiring authentication', async () => {
    const menu = [
      {
        id: 3,
        title: 'Test Pizza',
        description: 'Made for a router test',
        image: 'test-pizza.png',
        price: 0.01,
      },
    ];
    DB.getMenu.mockResolvedValue(menu);

    const response = await request(server).get('/api/order/menu');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(menu);
    expect(DB.getMenu).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/order/menu', () => {
  const menuItem = {
    title: 'Router Special',
    description: 'A pizza added by the router test',
    image: 'router-special.png',
    price: 0.0125,
  };

  test('rejects an unauthenticated request', async () => {
    const response = await request(server).put('/api/order/menu').send(menuItem);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'unauthorized' });
    expect(DB.addMenuItem).not.toHaveBeenCalled();
  });

  test('rejects an authenticated diner who is not an admin', async () => {
    const response = await authenticated(request(server).put('/api/order/menu'), diner).send(menuItem);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ message: 'unable to add menu item' });
    expect(DB.addMenuItem).not.toHaveBeenCalled();
  });

  test('allows an admin to add an item and returns the updated menu', async () => {
    const updatedMenu = [{ id: 8, ...menuItem }];
    DB.addMenuItem.mockResolvedValue(updatedMenu[0]);
    DB.getMenu.mockResolvedValue(updatedMenu);

    const response = await authenticated(request(server).put('/api/order/menu'), admin).send(menuItem);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updatedMenu);
    expect(DB.addMenuItem).toHaveBeenCalledWith(menuItem);
    expect(DB.getMenu).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/order', () => {
  test('requires authentication', async () => {
    const response = await request(server).get('/api/order');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'unauthorized' });
    expect(DB.getOrders).not.toHaveBeenCalled();
  });

  test('returns the authenticated diner orders for the requested page', async () => {
    const orders = {
      dinerId: diner.id,
      orders: [{ id: 31, franchiseId: 4, storeId: 9, items: [] }],
      page: '2',
    };
    DB.getOrders.mockResolvedValue(orders);

    const response = await authenticated(request(server).get('/api/order').query({ page: 2 }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(orders);
    expect(DB.getOrders).toHaveBeenCalledWith(expect.objectContaining({ id: diner.id }), '2');
  });
});

describe('POST /api/order', () => {
  const orderRequest = {
    franchiseId: 4,
    storeId: 9,
    items: [{ menuId: 3, description: 'Test Pizza', price: 0.01 }],
  };

  test('requires authentication', async () => {
    const response = await request(server).post('/api/order').send(orderRequest);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'unauthorized' });
    expect(DB.addDinerOrder).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('stores and fulfills an order', async () => {
    const storedOrder = { ...orderRequest, id: 45 };
    const factoryResponse = { reportUrl: 'https://factory.test/report/45', jwt: 'factory-jwt' };
    DB.addDinerOrder.mockResolvedValue(storedOrder);
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(factoryResponse),
    });

    const response = await authenticated(request(server).post('/api/order')).send(orderRequest);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      order: storedOrder,
      followLinkToEndChaos: factoryResponse.reportUrl,
      jwt: factoryResponse.jwt,
    });
    expect(DB.addDinerOrder).toHaveBeenCalledWith(expect.objectContaining({ id: diner.id }), orderRequest);
    expect(global.fetch).toHaveBeenCalledWith(`${config.factory.url}/api/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${config.factory.apiKey}`,
      },
      body: JSON.stringify({
        diner: { id: diner.id, name: diner.name, email: diner.email },
        order: storedOrder,
      }),
    });
  });

  test('returns a 500 response when the factory cannot fulfill the stored order', async () => {
    const storedOrder = { ...orderRequest, id: 46 };
    const reportUrl = 'https://factory.test/report/46';
    DB.addDinerOrder.mockResolvedValue(storedOrder);
    global.fetch.mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ reportUrl }),
    });

    const response = await authenticated(request(server).post('/api/order')).send(orderRequest);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message: 'Failed to fulfill order at factory',
      followLinkToEndChaos: reportUrl,
    });
    expect(DB.addDinerOrder).toHaveBeenCalledTimes(1);
  });
});
