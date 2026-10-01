const { DB, Role } = require('../database/database.js');

const uniqueValue = () => `${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;

const createMenuItem = () => ({
  title: `test-pizza-${uniqueValue()}`,
  description: 'A pizza created for a database integration test',
  image: 'test-pizza.png',
  price: 12.34,
});

const createUser = () => {
  const uniqueId = uniqueValue();
  return {
    name: `test-user-${uniqueId}`,
    email: `${uniqueId}@test.com`,
    password: 'test-password',
    roles: [{ role: Role.Diner }],
  };
};

async function withConnection(callback) {
  const connection = await DB.getConnection();
  try {
    return await callback(connection);
  } finally {
    await connection.end();
  }
}

async function cleanUpMenuItem(menuItemId) {
  await withConnection((connection) => DB.query(connection, 'DELETE FROM menu WHERE id=?', [menuItemId]));
}

async function cleanUpUser(userId) {
  await withConnection(async (connection) => {
    await DB.query(connection, 'DELETE FROM auth WHERE userId=?', [userId]);
    await DB.query(connection, 'DELETE FROM userRole WHERE userId=?', [userId]);
    await DB.query(connection, 'DELETE FROM user WHERE id=?', [userId]);
  });
}

async function cleanUpOrder(orderId) {
  await withConnection(async (connection) => {
    await DB.query(connection, 'DELETE FROM orderItem WHERE orderId=?', [orderId]);
    await DB.query(connection, 'DELETE FROM dinerOrder WHERE id=?', [orderId]);
  });
}

async function cleanUpFranchise(franchiseId) {
  await withConnection(async (connection) => {
    await DB.query(connection, 'DELETE FROM store WHERE franchiseId=?', [franchiseId]);
    await DB.query(connection, 'DELETE FROM userRole WHERE objectId=? AND role=?', [franchiseId, Role.Franchisee]);
    await DB.query(connection, 'DELETE FROM franchise WHERE id=?', [franchiseId]);
  });
}

async function createFranchise(admin) {
  return DB.createFranchise({
    name: `test-franchise-${uniqueValue()}`,
    admins: admin ? [{ email: admin.email }] : [],
  });
}

async function createOrderFixture() {
  const user = await DB.addUser(createUser());
  const franchise = await createFranchise();
  const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueValue()}` });
  const menuItem = await DB.addMenuItem(createMenuItem());

  return { user, franchise, store, menuItem };
}

async function cleanUpOrderFixture(fixture, orderId) {
  if (orderId) {
    await cleanUpOrder(orderId);
  }
  await cleanUpMenuItem(fixture.menuItem.id);
  await cleanUpFranchise(fixture.franchise.id);
  await cleanUpUser(fixture.user.id);
}

test('add a menu item to the database', async () => {
  const menuItem = createMenuItem();
  const createdItem = await DB.addMenuItem(menuItem);

  try {
    expect(createdItem).toEqual({ ...menuItem, id: expect.any(Number) });

    const rows = await withConnection((connection) => DB.query(connection, 'SELECT * FROM menu WHERE id=?', [createdItem.id]));
    expect(rows).toEqual([createdItem]);
  } finally {
    await cleanUpMenuItem(createdItem.id);
  }
});

test('retrieve a menu item from the database', async () => {
  const menuItem = createMenuItem();
  const createdItem = await DB.addMenuItem(menuItem);

  try {
    const menu = await DB.getMenu();

    expect(menu).toContainEqual(createdItem);
  } finally {
    await cleanUpMenuItem(createdItem.id);
  }
});

test('add a user to the database', async () => {
  const user = createUser();
  const createdUser = await DB.addUser(user);

  try {
    expect(createdUser).toEqual({ ...user, id: expect.any(Number), password: undefined });

    const storedUsers = await withConnection((connection) => DB.query(connection, 'SELECT * FROM user WHERE id=?', [createdUser.id]));
    expect(storedUsers).toHaveLength(1);
    expect(storedUsers[0]).toMatchObject({
      id: createdUser.id,
      name: user.name,
      email: user.email,
    });
    expect(storedUsers[0].password).not.toBe(user.password);

    const storedRoles = await withConnection((connection) => DB.query(connection, 'SELECT * FROM userRole WHERE userId=?', [createdUser.id]));
    expect(storedRoles).toContainEqual(
      expect.objectContaining({
        userId: createdUser.id,
        role: Role.Diner,
        objectId: 0,
      })
    );
  } finally {
    await cleanUpUser(createdUser.id);
  }
});

test('retrieve a user from the database', async () => {
  const user = createUser();
  const createdUser = await DB.addUser(user);

  try {
    const retrievedUser = await DB.getUser(user.email, user.password);

    expect(retrievedUser).toEqual({
      id: createdUser.id,
      name: user.name,
      email: user.email,
      password: undefined,
      roles: [{ objectId: undefined, role: Role.Diner }],
    });
  } finally {
    await cleanUpUser(createdUser.id);
  }
});

test('update a user in the database', async () => {
  const user = createUser();
  const createdUser = await DB.addUser(user);
  const updatedUser = {
    name: `updated-${user.name}`,
    email: `updated-${user.email}`,
    password: 'updated-password',
  };

  try {
    const result = await DB.updateUser(createdUser.id, updatedUser.name, updatedUser.email, updatedUser.password);

    expect(result).toEqual({
      id: createdUser.id,
      ...updatedUser,
      password: undefined,
      roles: [{ objectId: undefined, role: Role.Diner }],
    });

    await expect(DB.getUser(updatedUser.email, updatedUser.password)).resolves.toEqual(result);
  } finally {
    await cleanUpUser(createdUser.id);
  }
});

test('log a user in', async () => {
  const user = createUser();
  const createdUser = await DB.addUser(user);
  const tokenSignature = uniqueValue();
  const token = `header.payload.${tokenSignature}`;

  try {
    await expect(DB.loginUser(createdUser.id, token)).resolves.toBeUndefined();

    const authRows = await withConnection((connection) => DB.query(connection, 'SELECT * FROM auth WHERE token=?', [tokenSignature]));
    expect(authRows).toEqual([{ token: tokenSignature, userId: createdUser.id }]);
  } finally {
    await cleanUpUser(createdUser.id);
  }
});

test('check whether a user is logged in', async () => {
  const user = createUser();
  const createdUser = await DB.addUser(user);
  const token = `header.payload.${uniqueValue()}`;
  const unknownToken = `header.payload.${uniqueValue()}`;

  try {
    await DB.loginUser(createdUser.id, token);

    await expect(DB.isLoggedIn(token)).resolves.toBe(true);
    await expect(DB.isLoggedIn(unknownToken)).resolves.toBe(false);
  } finally {
    await cleanUpUser(createdUser.id);
  }
});

test('log a user out', async () => {
  const user = createUser();
  const createdUser = await DB.addUser(user);
  const token = `header.payload.${uniqueValue()}`;

  try {
    await DB.loginUser(createdUser.id, token);
    await expect(DB.isLoggedIn(token)).resolves.toBe(true);

    await expect(DB.logoutUser(token)).resolves.toBeUndefined();

    await expect(DB.isLoggedIn(token)).resolves.toBe(false);
  } finally {
    await cleanUpUser(createdUser.id);
  }
});

describe('order methods', () => {
  test('add a diner order to the database', async () => {
    const fixture = await createOrderFixture();
    const order = {
      franchiseId: fixture.franchise.id,
      storeId: fixture.store.id,
      items: [
        {
          menuId: fixture.menuItem.id,
          description: fixture.menuItem.description,
          price: fixture.menuItem.price,
        },
      ],
    };
    let createdOrder;

    try {
      createdOrder = await DB.addDinerOrder(fixture.user, order);

      expect(createdOrder).toEqual({ ...order, id: expect.any(Number) });

      const storedOrders = await withConnection((connection) =>
        DB.query(connection, 'SELECT id, dinerId, franchiseId, storeId FROM dinerOrder WHERE id=?', [createdOrder.id])
      );
      expect(storedOrders).toEqual([
        {
          id: createdOrder.id,
          dinerId: fixture.user.id,
          franchiseId: fixture.franchise.id,
          storeId: fixture.store.id,
        },
      ]);

      const storedItems = await withConnection((connection) =>
        DB.query(connection, 'SELECT orderId, menuId, description, price FROM orderItem WHERE orderId=?', [createdOrder.id])
      );
      expect(storedItems).toEqual([{ orderId: createdOrder.id, ...order.items[0] }]);
    } finally {
      await cleanUpOrderFixture(fixture, createdOrder?.id);
    }
  });

  test('retrieve a diner order from the database', async () => {
    const fixture = await createOrderFixture();
    const order = {
      franchiseId: fixture.franchise.id,
      storeId: fixture.store.id,
      items: [
        {
          menuId: fixture.menuItem.id,
          description: fixture.menuItem.description,
          price: fixture.menuItem.price,
        },
      ],
    };
    let createdOrder;

    try {
      createdOrder = await DB.addDinerOrder(fixture.user, order);
      const result = await DB.getOrders(fixture.user);

      expect(result).toEqual({
        dinerId: fixture.user.id,
        orders: [
          {
            id: createdOrder.id,
            franchiseId: fixture.franchise.id,
            storeId: fixture.store.id,
            date: expect.any(Date),
            items: [
              {
                id: expect.any(Number),
                ...order.items[0],
              },
            ],
          },
        ],
        page: 1,
      });
    } finally {
      await cleanUpOrderFixture(fixture, createdOrder?.id);
    }
  });
});

describe('franchise methods', () => {
  test('create a franchise in the database', async () => {
    const admin = await DB.addUser(createUser());
    let franchise;

    try {
      franchise = await createFranchise(admin);

      expect(franchise).toEqual({
        id: expect.any(Number),
        name: expect.stringMatching(/^test-franchise-/),
        admins: [{ id: admin.id, name: admin.name, email: admin.email }],
      });

      const storedFranchises = await withConnection((connection) => DB.query(connection, 'SELECT id, name FROM franchise WHERE id=?', [franchise.id]));
      expect(storedFranchises).toEqual([{ id: franchise.id, name: franchise.name }]);

      const storedRoles = await withConnection((connection) =>
        DB.query(connection, 'SELECT userId, role, objectId FROM userRole WHERE userId=? AND objectId=?', [admin.id, franchise.id])
      );
      expect(storedRoles).toEqual([{ userId: admin.id, role: Role.Franchisee, objectId: franchise.id }]);
    } finally {
      if (franchise) {
        await cleanUpFranchise(franchise.id);
      }
      await cleanUpUser(admin.id);
    }
  });

  test('delete a franchise and its stores from the database', async () => {
    const admin = await DB.addUser(createUser());
    const franchise = await createFranchise(admin);
    const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueValue()}` });

    try {
      await expect(DB.deleteFranchise(franchise.id)).resolves.toBeUndefined();

      const storedFranchises = await withConnection((connection) => DB.query(connection, 'SELECT id FROM franchise WHERE id=?', [franchise.id]));
      const storedStores = await withConnection((connection) => DB.query(connection, 'SELECT id FROM store WHERE id=?', [store.id]));
      const storedRoles = await withConnection((connection) =>
        DB.query(connection, 'SELECT id FROM userRole WHERE objectId=? AND role=?', [franchise.id, Role.Franchisee])
      );

      expect(storedFranchises).toEqual([]);
      expect(storedStores).toEqual([]);
      expect(storedRoles).toEqual([]);
    } finally {
      await cleanUpFranchise(franchise.id);
      await cleanUpUser(admin.id);
    }
  });

  test('retrieve filtered franchises from the database', async () => {
    const franchise = await createFranchise();
    const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueValue()}` });

    try {
      const [franchises, more] = await DB.getFranchises(undefined, 0, 10, franchise.name);

      expect(franchises).toEqual([
        {
          id: franchise.id,
          name: franchise.name,
          stores: [{ id: store.id, name: store.name }],
        },
      ]);
      expect(more).toBe(false);
    } finally {
      await cleanUpFranchise(franchise.id);
    }
  });

  test('retrieve the franchises administered by a user', async () => {
    const admin = await DB.addUser(createUser());
    const franchise = await createFranchise(admin);
    const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueValue()}` });

    try {
      const franchises = await DB.getUserFranchises(admin.id);

      expect(franchises).toEqual([
        {
          id: franchise.id,
          name: franchise.name,
          admins: [{ id: admin.id, name: admin.name, email: admin.email }],
          stores: [{ id: store.id, name: store.name, totalRevenue: 0 }],
        },
      ]);
    } finally {
      await cleanUpFranchise(franchise.id);
      await cleanUpUser(admin.id);
    }
  });

  test('retrieve franchise details', async () => {
    const admin = await DB.addUser(createUser());
    const franchise = await createFranchise(admin);
    const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueValue()}` });

    try {
      const result = await DB.getFranchise({ id: franchise.id, name: franchise.name });

      expect(result).toEqual({
        id: franchise.id,
        name: franchise.name,
        admins: [{ id: admin.id, name: admin.name, email: admin.email }],
        stores: [{ id: store.id, name: store.name, totalRevenue: 0 }],
      });
    } finally {
      await cleanUpFranchise(franchise.id);
      await cleanUpUser(admin.id);
    }
  });
});

describe('store methods', () => {
  test('create a store in the database', async () => {
    const franchise = await createFranchise();
    const storeName = `test-store-${uniqueValue()}`;

    try {
      const store = await DB.createStore(franchise.id, { name: storeName });

      expect(store).toEqual({ id: expect.any(Number), franchiseId: franchise.id, name: storeName });

      const storedStores = await withConnection((connection) => DB.query(connection, 'SELECT id, franchiseId, name FROM store WHERE id=?', [store.id]));
      expect(storedStores).toEqual([store]);
    } finally {
      await cleanUpFranchise(franchise.id);
    }
  });

  test('delete a store from the database', async () => {
    const franchise = await createFranchise();
    const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueValue()}` });

    try {
      await expect(DB.deleteStore(franchise.id, store.id)).resolves.toBeUndefined();

      const storedStores = await withConnection((connection) => DB.query(connection, 'SELECT id FROM store WHERE id=?', [store.id]));
      expect(storedStores).toEqual([]);
    } finally {
      await cleanUpFranchise(franchise.id);
    }
  });
});
