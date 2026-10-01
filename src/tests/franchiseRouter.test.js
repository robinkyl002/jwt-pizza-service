const request = require('supertest');
const app = require('../service');
const { DB } = require('../database/database.js');

const uniqueName = () => `${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;

let adminAuthToken;
let franchiseAdmin;
let franchiseAdminAuthToken;
let nonAdminAuthToken;
const createdFranchiseIds = new Set();
const createdUserIds = new Set();

async function registerUser(label) {
  const uniqueId = uniqueName();
  const registerRes = await request(app)
    .post('/api/auth')
    .send({
      name: `${label}-${uniqueId}`,
      email: `${label}-${uniqueId}@test.com`,
      password: 'password',
    });

  if (registerRes.status !== 200) {
    throw new Error(`Unable to register ${label}: ${registerRes.body.message}`);
  }

  createdUserIds.add(registerRes.body.user.id);
  return registerRes.body;
}

async function createTestFranchise(franchiseAdministrator = franchiseAdmin) {
  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({
      name: `test-franchise-${uniqueName()}`,
      admins: [{ email: franchiseAdministrator.email }],
    });

  if (createRes.body.id) {
    createdFranchiseIds.add(createRes.body.id);
  }
  expect(createRes.status).toBe(200);
  return createRes.body;
}

async function cleanUpUsers() {
  const userIds = [...createdUserIds];
  if (userIds.length === 0) {
    return;
  }

  const connection = await DB.getConnection();
  try {
    for (const userId of userIds) {
      await DB.query(connection, 'DELETE FROM auth WHERE userId=?', [userId]);
      await DB.query(connection, 'DELETE FROM userRole WHERE userId=?', [userId]);
      await DB.query(connection, 'DELETE FROM user WHERE id=?', [userId]);
    }
  } finally {
    await connection.end();
  }
}

beforeAll(async () => {
  const adminLoginRes = await request(app).put('/api/auth').send({
    email: 'a@jwt.com',
    password: 'admin',
  });

  if (adminLoginRes.status !== 200) {
    throw new Error(`Unable to log in the test administrator: ${adminLoginRes.body.message}`);
  }
  adminAuthToken = adminLoginRes.body.token;

  const registeredFranchiseAdmin = await registerUser('franchise-admin');
  franchiseAdmin = registeredFranchiseAdmin.user;
  franchiseAdminAuthToken = registeredFranchiseAdmin.token;

  const registeredNonAdmin = await registerUser('non-admin');
  nonAdminAuthToken = registeredNonAdmin.token;
});

afterEach(async () => {
  for (const franchiseId of createdFranchiseIds) {
    await DB.deleteFranchise(franchiseId);
  }
  createdFranchiseIds.clear();
});

afterAll(async () => {
  await cleanUpUsers();
});

test('an admin can create a franchise', async () => {
  const franchiseName = `test-franchise-${uniqueName()}`;

  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: franchiseAdmin.email }],
    });

  if (createRes.body.id) {
    createdFranchiseIds.add(createRes.body.id);
  }

  expect(createRes.status).toBe(200);
  expect(createRes.body).toEqual({
    id: expect.any(Number),
    name: franchiseName,
    admins: [
      {
        id: franchiseAdmin.id,
        name: franchiseAdmin.name,
        email: franchiseAdmin.email,
      },
    ],
  });
});

test('a non-admin cannot create a franchise', async () => {
  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${nonAdminAuthToken}`)
    .send({
      name: `test-franchise-${uniqueName()}`,
      admins: [{ email: franchiseAdmin.email }],
    });

  expect(createRes.status).toBe(403);
  expect(createRes.body).toMatchObject({
    message: 'unable to create a franchise',
  });
});

test('list franchises using the pagination and name filters', async () => {
  const franchise = await createTestFranchise();
  const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueName()}` });

  const listRes = await request(app)
    .get('/api/franchise')
    .query({ page: 0, limit: 10, name: franchise.name });

  expect(listRes.status).toBe(200);
  expect(listRes.body).toEqual({
    franchises: [
      {
        id: franchise.id,
        name: franchise.name,
        stores: [{ id: store.id, name: store.name }],
      },
    ],
    more: false,
  });
});

test('a user can list the franchises they administer', async () => {
  const franchise = await createTestFranchise();
  const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueName()}` });

  const listRes = await request(app)
    .get(`/api/franchise/${franchiseAdmin.id}`)
    .set('Authorization', `Bearer ${franchiseAdminAuthToken}`);

  expect(listRes.status).toBe(200);
  expect(listRes.body).toEqual([
    {
      id: franchise.id,
      name: franchise.name,
      admins: [
        {
          id: franchiseAdmin.id,
          name: franchiseAdmin.name,
          email: franchiseAdmin.email,
        },
      ],
      stores: [{ id: store.id, name: store.name, totalRevenue: 0 }],
    },
  ]);
});

test("an admin can list another user's franchises", async () => {
  const franchise = await createTestFranchise();

  const listRes = await request(app)
    .get(`/api/franchise/${franchiseAdmin.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(listRes.status).toBe(200);
  expect(listRes.body).toEqual([
    expect.objectContaining({
      id: franchise.id,
      name: franchise.name,
    }),
  ]);
});

test("a non-admin cannot list another user's franchises", async () => {
  await createTestFranchise();

  const listRes = await request(app)
    .get(`/api/franchise/${franchiseAdmin.id}`)
    .set('Authorization', `Bearer ${nonAdminAuthToken}`);

  expect(listRes.status).toBe(200);
  expect(listRes.body).toEqual([]);
});

test("listing a user's franchises requires authentication", async () => {
  const listRes = await request(app).get(`/api/franchise/${franchiseAdmin.id}`);

  expect(listRes.status).toBe(401);
  expect(listRes.body).toEqual({ message: 'unauthorized' });
});

test('delete a franchise', async () => {
  const franchise = await createTestFranchise();

  const deleteRes = await request(app)
    .delete(`/api/franchise/${franchise.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: 'franchise deleted' });

  const listRes = await request(app)
    .get('/api/franchise')
    .query({ page: 0, limit: 10, name: franchise.name });
  expect(listRes.body.franchises).toEqual([]);
});

test('a franchise administrator can create a store', async () => {
  const franchise = await createTestFranchise();
  const storeName = `test-store-${uniqueName()}`;

  const createRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set('Authorization', `Bearer ${franchiseAdminAuthToken}`)
    .send({ name: storeName });

  expect(createRes.status).toBe(200);
  expect(createRes.body).toEqual({
    id: expect.any(Number),
    franchiseId: franchise.id,
    name: storeName,
  });
});

test('an admin can create a store', async () => {
  const franchise = await createTestFranchise();
  const storeName = `test-store-${uniqueName()}`;

  const createRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: storeName });

  expect(createRes.status).toBe(200);
  expect(createRes.body).toMatchObject({
    franchiseId: franchise.id,
    name: storeName,
  });
});

test('an unrelated user cannot create a store', async () => {
  const franchise = await createTestFranchise();

  const createRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set('Authorization', `Bearer ${nonAdminAuthToken}`)
    .send({ name: `test-store-${uniqueName()}` });

  expect(createRes.status).toBe(403);
  expect(createRes.body).toMatchObject({
    message: 'unable to create a store',
  });
});

test('a franchise administrator can delete a store', async () => {
  const franchise = await createTestFranchise();
  const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueName()}` });

  const deleteRes = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${store.id}`)
    .set('Authorization', `Bearer ${franchiseAdminAuthToken}`);

  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: 'store deleted' });

  const listRes = await request(app)
    .get('/api/franchise')
    .query({ page: 0, limit: 10, name: franchise.name });
  expect(listRes.body.franchises[0].stores).toEqual([]);
});

test('an unrelated user cannot delete a store', async () => {
  const franchise = await createTestFranchise();
  const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueName()}` });

  const deleteRes = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${store.id}`)
    .set('Authorization', `Bearer ${nonAdminAuthToken}`);

  expect(deleteRes.status).toBe(403);
  expect(deleteRes.body).toMatchObject({
    message: 'unable to delete a store',
  });
});

test.each([
  ['creating', 'post'],
  ['deleting', 'delete'],
])('%s a store requires authentication', async (operation, method) => {
  const franchise = await createTestFranchise();
  const store = await DB.createStore(franchise.id, { name: `test-store-${uniqueName()}` });
  const path = method === 'post' ? `/api/franchise/${franchise.id}/store` : `/api/franchise/${franchise.id}/store/${store.id}`;

  const storeRes = await request(app)[method](path).send({ name: `test-store-${uniqueName()}` });

  expect(storeRes.status).toBe(401);
  expect(storeRes.body).toEqual({ message: 'unauthorized' });
});
