// Fix SQL column references in communities.js
import fs from 'fs';
const filePath = 'Gestion/communities.js';
let content = fs.readFileSync(filePath, 'utf8');

let changes = 0;

// Fix u.full_name AS admin_name, (appears in GET / and GET /:id)
let before = content;
content = content.replace(
    /u\.full_name AS admin_name,/g,
    "COALESCE(u.first_name || ' ' || u.last_name, u.email) AS admin_name,"
);
changes += (before.length - content.length) > 0 ? 1 : 0;

// Fix u.full_name  AS name, (appears in members queries - 2 spaces before AS)
before = content;
content = content.replace(
    /u\.full_name  AS name,/g,
    "COALESCE(u.first_name || ' ' || u.last_name, u.email) AS name,"
);

// Fix u.full_name AS author_name, (1 space before AS - in GET /:id posts)
before = content;
content = content.replace(
    /u\.full_name AS author_name,/g,
    "COALESCE(u.first_name || ' ' || u.last_name, u.email) AS author_name,"
);

// Fix u.full_name  AS author_name, (2 spaces before AS - in GET /:id/posts and comments)
before = content;
content = content.replace(
    /u\.full_name  AS author_name,/g,
    "COALESCE(u.first_name || ' ' || u.last_name, u.email) AS author_name,"
);

// Fix u.avatar_url AS author_avatar, (with comma)
before = content;
content = content.replace(
    /u\.avatar_url AS author_avatar,/g,
    'NULL::TEXT AS author_avatar,'
);

// Fix u.avatar_url AS author_avatar (without comma, in comments query)
before = content;
content = content.replace(
    /u\.avatar_url AS author_avatar\b(?!,)/g,
    'NULL::TEXT AS author_avatar'
);

// Fix standalone u.avatar_url (in members queries, on its own line)
before = content;
content = content.replace(
    /u\.avatar_url\r\n/g,
    'NULL::TEXT AS avatar_url\r\n'
);
content = content.replace(
    /u\.avatar_url\n/g,
    'NULL::TEXT AS avatar_url\n'
);

// Fix SELECT full_name FROM users
before = content;
content = content.replace(
    /SELECT full_name FROM users WHERE id = \$1/g,
    "SELECT COALESCE(first_name || ' ' || last_name, email) AS full_name FROM users WHERE id = $1"
);

fs.writeFileSync(filePath, content);

// Verify
const hasFullName = content.includes('u.full_name');
const hasAvatarUrl = content.includes('u.avatar_url');
const hasSelectFullName = content.includes('SELECT full_name FROM users');
console.log('Remaining u.full_name:', hasFullName);
console.log('Remaining u.avatar_url:', hasAvatarUrl);
console.log('Remaining SELECT full_name FROM users:', hasSelectFullName);
console.log('SQL column fixes applied.');
