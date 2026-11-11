import http from 'http';
import pool from './db.js';

const COMMUNITY_ID = 'f76e6882-148b-4fcc-bc1f-0d4bcce1efca';
const USER_ID = 'ab872e56-d17d-44a0-8a69-3e875e6f9b70';

async function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {},
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getLikesCount(postId) {
  const result = await pool.query('SELECT likes_count FROM posts WHERE id = $1', [postId]);
  const val = result.rows[0]?.likes_count;
  return val === undefined || val === null ? 'NULL' : String(val);
}

async function run() {
  // Clean up any existing test posts
  await pool.query('DELETE FROM post_likes WHERE post_id IN (SELECT id FROM posts WHERE community_id = $1 AND content LIKE \'Test%\')', [COMMUNITY_ID]);
  await pool.query('DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE community_id = $1 AND content LIKE \'Test%\')', [COMMUNITY_ID]);
  await pool.query('DELETE FROM posts WHERE community_id = $1 AND content LIKE \'Test%\'', [COMMUNITY_ID]);

  console.log('=== Testing POST creation ===');
  let res = await apiRequest(`/api/communities/${COMMUNITY_ID}/posts`, 'POST', {
    author_id: USER_ID,
    content: 'Test like/unlike',
    post_type: 'text'
  });
  console.log(`Status: ${res.status}`);
  let post = JSON.parse(res.body);
  let postId = post.data?.id;
  console.log(`Post ID: ${postId}`);
  console.log(`Initial likes_count: ${await getLikesCount(postId)}`);

  console.log('\n=== Testing LIKE ===');
  res = await apiRequest(`/api/communities/${COMMUNITY_ID}/posts/${postId}/like`, 'POST', { user_id: USER_ID });
  console.log(`Status: ${res.status}`);
  console.log(`Response: ${res.body}`);
  let lc = await getLikesCount(postId);
  console.log(`after like: ${lc}`);
  console.log(`Like count is 1? ${lc === '1' ? 'YES ✅' : 'NO ❌'}`);

  console.log('\n=== Testing UNLIKE ===');
  res = await apiRequest(`/api/communities/${COMMUNITY_ID}/posts/${postId}/like`, 'POST', { user_id: USER_ID });
  console.log(`Status: ${res.status}`);
  console.log(`Response: ${res.body}`);
  lc = await getLikesCount(postId);
  console.log(`after unlike: ${lc}`);
  console.log(`Like count is 0? ${lc === '0' ? 'YES ✅' : 'NO ❌'}`);

  console.log('\n=== Testing DELETE (with author_id in body) ===');
  res = await apiRequest(`/api/communities/${COMMUNITY_ID}/posts/${postId}`, 'DELETE', { author_id: USER_ID });
  console.log(`Status: ${res.status}`);
  console.log(`Response: ${res.body}`);

  console.log('\n=== Testing DELETE (without body) ===');
  // Create another post to test DELETE without body
  res = await apiRequest(`/api/communities/${COMMUNITY_ID}/posts`, 'POST', {
    author_id: USER_ID,
    content: 'Test DELETE 2',
    post_type: 'text'
  });
  let post2 = JSON.parse(res.body);
  let postId2 = post2.data?.id;
  console.log(`Post2 ID: ${postId2}`);
  
  res = await apiRequest(`/api/communities/${COMMUNITY_ID}/posts/${postId2}`, 'DELETE');
  console.log(`Status: ${res.status}`);
  console.log(`Response: ${res.body.slice(0, 400)}`);

  // Cleanup
  await pool.query('DELETE FROM posts WHERE community_id = $1', [COMMUNITY_ID]);

  process.exit(0);
}

run().catch(e => { console.error('Fatal error:', e.message); process.exit(1); });
