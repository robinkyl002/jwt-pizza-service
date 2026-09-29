const request = require('supertest');
const app = require('../service');

const uniqueName = () => Math.random().toString(36).substring(2, 12);

let adminAuthToken;
let franchiseAdmin;
let createdFranchiseId;

beforeAll(async () => {
  const adminLoginRes = await request(app).put('/api/auth').send({
    email: 'a@jwt.com',
    password: 'admin',
  });
  adminAuthToken = adminLoginRes.body.token;

  const name = uniqueName();
  const registerRes = await request(app)
    .post('/api/auth')
    .send({
      name: `${name} franchise admin`,
      email: `${name}@test.com`,
      password: 'password',
    });
  franchiseAdmin = registerRes.body.user;
});

afterAll(async () => {
  if (createdFranchiseId) {
    await request(app)
      .delete(`/api/franchise/${createdFranchiseId}`)
      .set('Authorization', `Bearer ${adminAuthToken}`);
  }
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

  createdFranchiseId = createRes.body.id;

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
