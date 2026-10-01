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
