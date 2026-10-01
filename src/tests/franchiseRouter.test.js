jest.mock('../database/database.js', () => ({
  Role: {
    Diner: 'diner',
    Franchisee: 'franchisee',
    Admin: 'admin',
  },
  DB: {
    isLoggedIn: jest.fn(),
    getFranchises: jest.fn(),
    getUserFranchises: jest.fn(),
    createFranchise: jest.fn(),
    deleteFranchise: jest.fn(),
    getFranchise: jest.fn(),
    createStore: jest.fn(),
    deleteStore: jest.fn(),
  },
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../config.js');
const app = require('../service.js');
const { DB, Role } = require('../database/database.js');

const admin = {
  id: 1,
  name: 'Test Admin',
  email: 'admin@test.com',
  roles: [{ role: Role.Admin }],
};

const franchiseAdmin = {
  id: 17,
  name: 'Test Franchise Admin',
  email: 'franchise-admin@test.com',
  roles: [{ role: Role.Franchisee }],
};

const diner = {
  id: 18,
  name: 'Test Diner',
  email: 'diner@test.com',
  roles: [{ role: Role.Diner }],
};

const franchise = {
  id: 4,
  name: 'Test Franchise',
  admins: [
    {
      id: franchiseAdmin.id,
      name: franchiseAdmin.name,
      email: franchiseAdmin.email,
    },
  ],
};

const store = {
  id: 9,
  franchiseId: franchise.id,
  name: 'Test Store',
};

function tokenFor(user) {
  return jwt.sign(user, config.jwtSecret);
}

function authenticated(requestBuilder, user) {
  return requestBuilder.set('Authorization', `Bearer ${tokenFor(user)}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  DB.isLoggedIn.mockResolvedValue(true);
});

describe('POST /api/franchise', () => {
  const franchiseRequest = {
    name: franchise.name,
    admins: [{ email: franchiseAdmin.email }],
  };

  test('an admin can create a franchise', async () => {
    DB.createFranchise.mockResolvedValue(franchise);

    const response = await authenticated(request(app).post('/api/franchise'), admin).send(franchiseRequest);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(franchise);
    expect(DB.createFranchise).toHaveBeenCalledWith(franchiseRequest);
  });

  test('a non-admin cannot create a franchise', async () => {
    const response = await authenticated(request(app).post('/api/franchise'), diner).send(franchiseRequest);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      message: 'unable to create a franchise',
    });
    expect(DB.createFranchise).not.toHaveBeenCalled();
  });
});

describe('GET /api/franchise', () => {
  test('lists franchises using the pagination and name filters', async () => {
    const listedFranchise = {
      id: franchise.id,
      name: franchise.name,
      stores: [{ id: store.id, name: store.name }],
    };
    DB.getFranchises.mockResolvedValue([[listedFranchise], false]);

    const response = await request(app).get('/api/franchise').query({
      page: 0,
      limit: 10,
      name: franchise.name,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      franchises: [listedFranchise],
      more: false,
    });
    expect(DB.getFranchises).toHaveBeenCalledWith(undefined, '0', '10', franchise.name);
  });
});

describe('GET /api/franchise/:userId', () => {
  const userFranchises = [
    {
      ...franchise,
      stores: [{ id: store.id, name: store.name, totalRevenue: 0 }],
    },
  ];

  test('a user can list the franchises they administer', async () => {
    DB.getUserFranchises.mockResolvedValue(userFranchises);

    const response = await authenticated(request(app).get(`/api/franchise/${franchiseAdmin.id}`), franchiseAdmin);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(userFranchises);
    expect(DB.getUserFranchises).toHaveBeenCalledWith(franchiseAdmin.id);
  });

  test("an admin can list another user's franchises", async () => {
    DB.getUserFranchises.mockResolvedValue(userFranchises);

    const response = await authenticated(request(app).get(`/api/franchise/${franchiseAdmin.id}`), admin);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(userFranchises);
    expect(DB.getUserFranchises).toHaveBeenCalledWith(franchiseAdmin.id);
  });

  test("a non-admin cannot list another user's franchises", async () => {
    const response = await authenticated(request(app).get(`/api/franchise/${franchiseAdmin.id}`), diner);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(DB.getUserFranchises).not.toHaveBeenCalled();
  });

  test("listing a user's franchises requires authentication", async () => {
    const response = await request(app).get(`/api/franchise/${franchiseAdmin.id}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'unauthorized' });
    expect(DB.getUserFranchises).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/franchise/:franchiseId', () => {
  test('deletes a franchise', async () => {
    DB.deleteFranchise.mockResolvedValue();

    const response = await authenticated(request(app).delete(`/api/franchise/${franchise.id}`), admin);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'franchise deleted' });
    expect(DB.deleteFranchise).toHaveBeenCalledWith(franchise.id);
  });
});

describe('POST /api/franchise/:franchiseId/store', () => {
  test('a franchise administrator can create a store', async () => {
    DB.getFranchise.mockResolvedValue(franchise);
    DB.createStore.mockResolvedValue(store);

    const response = await authenticated(request(app).post(`/api/franchise/${franchise.id}/store`), franchiseAdmin).send({ name: store.name });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(store);
    expect(DB.getFranchise).toHaveBeenCalledWith({ id: franchise.id });
    expect(DB.createStore).toHaveBeenCalledWith(franchise.id, { name: store.name });
  });

  test('an admin can create a store', async () => {
    DB.getFranchise.mockResolvedValue(franchise);
    DB.createStore.mockResolvedValue(store);

    const response = await authenticated(request(app).post(`/api/franchise/${franchise.id}/store`), admin).send({ name: store.name });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(store);
    expect(DB.getFranchise).toHaveBeenCalledWith({ id: franchise.id });
    expect(DB.createStore).toHaveBeenCalledWith(franchise.id, { name: store.name });
  });

  test('an unrelated user cannot create a store', async () => {
    DB.getFranchise.mockResolvedValue(franchise);

    const response = await authenticated(request(app).post(`/api/franchise/${franchise.id}/store`), diner).send({ name: store.name });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      message: 'unable to create a store',
    });
    expect(DB.getFranchise).toHaveBeenCalledWith({ id: franchise.id });
    expect(DB.createStore).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/franchise/:franchiseId/store/:storeId', () => {
  test('a franchise administrator can delete a store', async () => {
    DB.getFranchise.mockResolvedValue(franchise);
    DB.deleteStore.mockResolvedValue();

    const response = await authenticated(request(app).delete(`/api/franchise/${franchise.id}/store/${store.id}`), franchiseAdmin);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'store deleted' });
    expect(DB.getFranchise).toHaveBeenCalledWith({ id: franchise.id });
    expect(DB.deleteStore).toHaveBeenCalledWith(franchise.id, store.id);
  });

  test('an unrelated user cannot delete a store', async () => {
    DB.getFranchise.mockResolvedValue(franchise);

    const response = await authenticated(request(app).delete(`/api/franchise/${franchise.id}/store/${store.id}`), diner);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      message: 'unable to delete a store',
    });
    expect(DB.getFranchise).toHaveBeenCalledWith({ id: franchise.id });
    expect(DB.deleteStore).not.toHaveBeenCalled();
  });
});

test.each([
  ['creating', 'post', `/api/franchise/${franchise.id}/store`],
  ['deleting', 'delete', `/api/franchise/${franchise.id}/store/${store.id}`],
])('%s a store requires authentication', async (operation, method, path) => {
  const response = await request(app)[method](path).send({ name: store.name });

  expect(response.status).toBe(401);
  expect(response.body).toEqual({ message: 'unauthorized' });
  expect(DB.getFranchise).not.toHaveBeenCalled();
  expect(DB.createStore).not.toHaveBeenCalled();
  expect(DB.deleteStore).not.toHaveBeenCalled();
});
