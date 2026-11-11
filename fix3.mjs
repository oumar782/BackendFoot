// Fix likes_count update in like/unlike route (CRLF version)
import fs from 'fs';
const filePath = 'Gestion/communities.js';
let content = fs.readFileSync(filePath, 'utf8');

// Add likes_count update after INSERT post_likes
const oldInsert = 'await pool.query(\r\n                `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)`,\r\n                [postId, user_id]\r\n            );';
const newInsert = 'await pool.query(\r\n                `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)`,\r\n                [postId, user_id]\r\n            );\r\n            await pool.query(\r\n                `UPDATE posts SET likes_count = likes_count + 1 WHERE id = $1`,\r\n                [postId]\r\n            );';

if (content.includes(oldInsert)) {
    content = content.replace(oldInsert, newInsert);
    console.log('INSERT likes_count update added!');
} else {
    console.log('WARNING: INSERT pattern not found.');
}

// Add likes_count update after DELETE post_likes
const oldDelete = 'await pool.query(\r\n                `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`,\r\n                [postId, user_id]\r\n            );';
const newDelete = 'await pool.query(\r\n                `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`,\r\n                [postId, user_id]\r\n            );\r\n            await pool.query(\r\n                `UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1`,\r\n                [postId]\r\n            );';

if (content.includes(oldDelete)) {
    content = content.replace(oldDelete, newDelete);
    console.log('DELETE likes_count update added!');
} else {
    console.log('WARNING: DELETE pattern not found.');
}

fs.writeFileSync(filePath, content);
console.log('Likes count fixes applied.');

