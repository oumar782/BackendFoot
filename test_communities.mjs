import http from 'http';

const COMMUNITY_ID = 'f76e6882-148b-4fcc-bc1f-0d4bcce1efca';
const USER_ID = 'ab872e56-d17d-44a0-8a69-3e875e6f9b70';
const POST_ID = 'test-post-001'; // Will use a fake UUID for posts

function realUUID(n) {
  // Generate a deterministic UUID for testing
  return n.toString().padStart(8, '0') + '-0000-0000-0000-00000000000' + n.toString();
}

const tests = [
  { name: 'GET / (list) with sport filter', path: '/api/communities/?sport=foot', method: 'GET' },
  { name: 'GET / (list) with sport=Football (partial)', path: '/api/communities/?sport=foot', method: 'GET' },
  { name: 'GET /stats/overview', path: '/api/communities/stats/overview', method: 'GET' },
  { name: 'GET /notifications/:userId', path: `/api/communities/notifications/${USER_ID}`, method: 'GET' },
  { name: 'GET /:id', path: `/api/communities/${COMMUNITY_ID}`, method: 'GET' },
  { name: 'GET /:id/members', path: `/api/communities/${COMMUNITY_ID}/members`, method: 'GET' },
  { name: 'POST /:id/join', path: `/api/communities/${COMMUNITY_ID}/join`, method: 'POST', body: { user_id: USER_ID, level: 'Débutant' } },
];

async function runTest(test) {
  return new Promise((resolve) => {
    const body = test.body ? JSON.stringify(test.body) : null;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: test.path,
      method: test.method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          name: test.name,
          path: test.path,
          status: res.statusCode,
          body: data,
        });
      });
    });
    req.on('error', (e) => resolve({ name: test.name, path: test.path, error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

let lastPostId = null;

for (const test of tests) {
  const result = await runTest(test);
  console.log(`\n${result.name}:`);
  console.log(`  Path: ${result.path}`);
  console.log(`  Status: ${result.status || 'ERROR'}`);
  if (result.error) console.log(`  Error: ${result.error}`);
  if (result.body) {
    try {
      const json = JSON.parse(result.body);
      console.log(`  Body: ${JSON.stringify(json).slice(0, 500)}`);
    } catch {
      console.log(`  Body: ${result.body.slice(0, 300)}`);
    }
  }
  await new Promise(r => setTimeout(r, 200));
}

// Now test post creation and like/unlike with the community
console.log('\n--- Testing POST creation and like/unlike ---');

// Create a post
const createPostResult = await runTest({
  name: 'POST /:id/posts',
  path: `/api/communities/${COMMUNITY_ID}/posts`,
  method: 'POST',
  body: { author_id: USER_ID, content: 'Ceci est un post de test', post_type: 'text' }
});
console.log(`\n${createPostResult.name}: Status=${createPostResult.status}`);
if (createPostResult.body) {
  try {
    const json = JSON.parse(createPostResult.body);
    console.log(`  Body: ${JSON.stringify(json).slice(0, 500)}`);
    lastPostId = json.data?.id;
  } catch {
    console.log(`  Body: ${createPostResult.body.slice(0, 300)}`);
  }
}

if (lastPostId) {
  console.log(`\nUsing postId: ${lastPostId}`);
  
  // Get posts to see the created post
  const getPostsResult = await runTest({
    name: 'GET /:id/posts',
    path: `/api/communities/${COMMUNITY_ID}/posts?user_id=${USER_ID}`,
    method: 'GET'
  });
  console.log(`\n${getPostsResult.name}: Status=${getPostsResult.status}`);
  if (getPostsResult.body) console.log(`  Body: ${getPostsResult.body.slice(0, 600)}`);
  
  // Like the post
  const likeResult = await runTest({
    name: 'POST /:id/posts/:postId/like',
    path: `/api/communities/${COMMUNITY_ID}/posts/${lastPostId}/like`,
    method: 'POST',
    body: { user_id: USER_ID }
  });
  console.log(`\n${likeResult.name}: Status=${likeResult.status}`);
  if (likeResult.body) console.log(`  Body: ${likeResult.body.slice(0, 300)}`);
  
  // Unlike the post
  const unlikeResult = await runTest({
    name: 'POST /:id/posts/:postId/like (unlike)',
    path: `/api/communities/${COMMUNITY_ID}/posts/${lastPostId}/like`,
    method: 'POST',
    body: { user_id: USER_ID }
  });
  console.log(`\n${unlikeResult.name}: Status=${unlikeResult.status}`);
  if (unlikeResult.body) console.log(`  Body: ${unlikeResult.body.slice(0, 300)}`);
  
  // Add a comment
  const commentResult = await runTest({
    name: 'POST /:id/posts/:postId/comments',
    path: `/api/communities/${COMMUNITY_ID}/posts/${lastPostId}/comments`,
    method: 'POST',
    body: { author_id: USER_ID, content: 'Super post !' }
  });
  console.log(`\n${commentResult.name}: Status=${commentResult.status}`);
  if (commentResult.body) console.log(`  Body: ${commentResult.body.slice(0, 300)}`);
  
  // Get comments
  const getCommentsResult = await runTest({
    name: 'GET /:id/posts/:postId/comments',
    path: `/api/communities/${COMMUNITY_ID}/posts/${lastPostId}/comments`,
    method: 'GET'
  });
  console.log(`\n${getCommentsResult.name}: Status=${getCommentsResult.status}`);
  if (getCommentsResult.body) console.log(`  Body: ${getCommentsResult.body.slice(0, 400)}`);
  
  // Delete the post
  const deletePostResult = await runTest({
    name: 'DELETE /:id/posts/:postId',
    path: `/api/communities/${COMMUNITY_ID}/posts/${lastPostId}`,
    method: 'DELETE',
    body: { author_id: USER_ID }
  });
  console.log(`\n${deletePostResult.name}: Status=${deletePostResult.status}`);
  if (deletePostResult.body) console.log(`  Body: ${deletePostResult.body.slice(0, 300)}`);
}

// Update community (PUT /:id)
const updateResult = await runTest({
  name: 'PUT /:id',
  path: `/api/communities/${COMMUNITY_ID}`,
  method: 'PUT',
  body: { description: 'Description mise à jour' }
});
console.log(`\n${updateResult.name}: Status=${updateResult.status}`);
if (updateResult.body) console.log(`  Body: ${updateResult.body.slice(0, 400)}`);

