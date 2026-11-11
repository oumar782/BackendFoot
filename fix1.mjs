// Fix script for communities.js
import fs from 'fs';
const filePath = 'Gestion/communities.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix indentation issues from previous edits
content = content.replace(
    /                                COALESCE\(u\.first_name \|\| ' ' \|\| u\.last_name, u\.email\) AS admin_name,/g,
    "                COALESCE(u.first_name || ' ' || u.last_name, u.email) AS admin_name,"
);

// Fix sport filter indentation
content = content.replace(
    /                if \(sport\) \{\n            paramCount\+\+;\n            sql \+= ` AND c\.sport ILIKE \$\{paramCount\}`;\n            params\.push\(`%$\{sport\}`\);\n        \}/g,
    '        if (sport) {\n            paramCount++;\n            sql += ` AND c.sport ILIKE $${paramCount}`;\n            params.push(`%${sport}%`);\n        }'
);

// Fix count sport filter indentation
content = content.replace(
    /                if \(sport\) \{\n            cCount\+\+;\n            countSql \+= ` AND c\.sport ILIKE \$\{cCount\}`;\n            countParams\.push\(`%$\{sport\}`\);\n        \}/g,
    '        if (sport) {\n            cCount++;\n            countSql += ` AND c.sport ILIKE $${cCount}`;\n            countParams.push(`%${sport}%`);\n        }'
);

// Fix c.quartier indentation
content = content.replace(
    /                                c\.quartier,\n                                c\.is_private,/g,
    '                c.quartier,\n                c.is_private,'
);

fs.writeFileSync(filePath, content);
console.log('Indentation fixes applied.');
