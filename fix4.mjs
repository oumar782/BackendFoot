import fs from 'fs';
const filePath = 'Gestion/communities.js';
let content = fs.readFileSync(filePath, 'utf8');

// Fix line 36: "                if (sport) {" -> "        if (sport) {"
// Only in the main query (before "const result = await pool.query")
let old36 = '        const params = [];\r\n        let paramCount = 0;\r\n\r\n                if (sport) {\r\n            paramCount++;';
let new36 = '        const params = [];\r\n        let paramCount = 0;\r\n\r\n        if (sport) {\r\n            paramCount++;';

if (content.includes(old36)) {
    content = content.replace(old36, new36);
    console.log('Fixed sport filter indentation in main query');
} else {
    // Try without \r\n (LF only)
    old36 = old36.replace(/\r\n/g, '\n');
    new36 = new36.replace(/\r\n/g, '\n');
    if (content.includes(old36)) {
        content = content.replace(old36, new36);
        console.log('Fixed sport filter indentation in main query (LF)');
    } else {
        console.log('WARNING: Could not find sport filter pattern for main query');
    }
}

// Fix count query sport filter indentation
let old76 = '        const countParams = [];\r\n        let cCount = 0;\r\n\r\n                if (sport) {\r\n            cCount++;';
let new76 = '        const countParams = [];\r\n        let cCount = 0;\r\n\r\n        if (sport) {\r\n            cCount++;';

if (content.includes(old76)) {
    content = content.replace(old76, new76);
    console.log('Fixed sport filter indentation in count query');
} else {
    old76 = old76.replace(/\r\n/g, '\n');
    new76 = new76.replace(/\r\n/g, '\n');
    if (content.includes(old76)) {
        content = content.replace(old76, new76);
        console.log('Fixed sport filter indentation in count query (LF)');
    } else {
        console.log('WARNING: Could not find sport filter pattern for count query');
    }
}

// Fix c.quartier indentation (32 spaces -> 16 spaces)
let old137 = '                c.city,\r\n                                c.quartier,\r\n                c.is_private,';
let new137 = '                c.city,\r\n                c.quartier,\r\n                c.is_private,';

if (content.includes(old137)) {
    content = content.replace(old137, new137);
    console.log('Fixed c.quartier indentation in GET /:id');
} else {
    old137 = old137.replace(/\r\n/g, '\n');
    new137 = new137.replace(/\r\n/g, '\n');
    if (content.includes(old137)) {
        content = content.replace(old137, new137);
        console.log('Fixed c.quartier indentation in GET /:id (LF)');
    } else {
        console.log('WARNING: Could not find c.quartier pattern');
    }
}

fs.writeFileSync(filePath, content);
console.log('Indentation cleanup done.');

