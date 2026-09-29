const request = require('supertest');
const app = require('../service');
// const { Role } = require('../database/database.js');
// const { DB } = require('../database/database.js');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;
let testUserId;

// function randomName() {
//   return Math.random().toString(36).substring(2, 12);
// }

// async function createAdminUser() {
//   let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
//   user.name = randomName();
//   user.email = user.name + '@admin.com';

//   await DB.addUser(user);
//   user.password = 'toomanysecrets';

//   return user;
// }

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  testUserId = registerRes.body.user.id;
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expect(loginRes.body.token).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);

  const user = { ...testUser, roles: [{ role: 'diner' }] };
  delete user.password;
  // const { password, ...user } = { ...testUser, roles: [{ role: 'diner' }] };
  expect(loginRes.body.user).toMatchObject(user);
});

test('retrieve the menu as a registered user', async () => {
  const menuRes = await request(app)
    .get('/api/order/menu')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(menuRes.status).toBe(200);
  // expect(menuRes.body).toEqual(
  //   expect.arrayContaining([
  //     expect.objectContaining({ title: 'Crusty' }),
  //   ])
  // );
});

test('update a user', async () => {
  const updatedUser = {
    name: 'updated pizza diner',
    email: Math.random().toString(36).substring(2, 12) + '@test.com',
    password: 'updated-password',
  };

  const updateRes = await request(app)
    .put(`/api/user/${testUserId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(updatedUser);

  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({
    id: testUserId,
    name: updatedUser.name,
    email: updatedUser.email,
    roles: [{ role: 'diner' }],
  });
  expect(updateRes.body.user).not.toHaveProperty('password');
  expect(updateRes.body.token).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);

  const meRes = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${updateRes.body.token}`);

  expect(meRes.status).toBe(200);
  expect(meRes.body).toMatchObject({
    id: testUserId,
    name: updatedUser.name,
    email: updatedUser.email,
    roles: [{ role: 'diner' }],
  });

  const loginRes = await request(app).put('/api/auth').send({
    email: updatedUser.email,
    password: updatedUser.password,
  });

  expect(loginRes.status).toBe(200);
  expect(loginRes.body.user).toMatchObject({
    id: testUserId,
    name: updatedUser.name,
    email: updatedUser.email,
  });
});

test('logout invalidates the user token', async () => {
  const logoutRes = await request(app)
    .delete('/api/auth')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(logoutRes.status).toBe(200);
  expect(logoutRes.body).toEqual({ message: 'logout successful' });

  const ordersRes = await request(app)
    .get('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(ordersRes.status).toBe(401);
  expect(ordersRes.body).toEqual({ message: 'unauthorized' });
});
