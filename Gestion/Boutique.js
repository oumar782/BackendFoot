import express from 'express';
import pool from '../db.js';

const router = express.Router();

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  }
};

const normalizeProduct = (row) => ({
  ...row,
  price: Number(row.price),
  discount: Number(row.discount || 0),
  stock: Number(row.stock || 0),
  sizes: parseJsonArray(row.sizes),
  images: parseJsonArray(row.images || row.image),
});

router.post('/products', async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      sport,
      price,
      discount = 0,
      stock = 0,
      sizes = [],
      brand,
      image,
      images,
    } = req.body;

    const productImages = images?.length ? images : [image].filter(Boolean);
    const result = await pool.query(
      `INSERT INTO products (name, description, sport, category, brand, price, discount, stock, sizes, images)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [name, description, sport, category, brand, price, discount, stock, JSON.stringify(sizes), JSON.stringify(productImages)]
    );

    res.status(201).json({ id: result.rows[0].id, ...req.body, images: productImages });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la creation du produit', error: error.message });
  }
});

router.get('/products', async (req, res) => {
  try {
    const { sport, category, minPrice, maxPrice, size, search, brand } = req.query;
    const clauses = [];
    const values = [];
    let paramIndex = 1;

    if (sport) {
      clauses.push(`sport = $${paramIndex}`);
      values.push(sport);
      paramIndex++;
    }
    if (category) {
      clauses.push(`category = $${paramIndex}`);
      values.push(category);
      paramIndex++;
    }
    if (brand) {
      clauses.push(`brand = $${paramIndex}`);
      values.push(brand);
      paramIndex++;
    }
    if (minPrice) {
      clauses.push(`price >= $${paramIndex}`);
      values.push(Number(minPrice));
      paramIndex++;
    }
    if (maxPrice) {
      clauses.push(`price <= $${paramIndex}`);
      values.push(Number(maxPrice));
      paramIndex++;
    }
    if (size) {
      clauses.push(`sizes LIKE $${paramIndex}`);
      values.push(`%"${size}"%`);
      paramIndex++;
    }
    if (search) {
      clauses.push(`(LOWER(name) LIKE $${paramIndex} OR LOWER(brand) LIKE $${paramIndex + 1})`);
      values.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
      paramIndex += 2;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query(`SELECT * FROM products ${where} ORDER BY created_at DESC`, values);
    res.json(result.rows.map(normalizeProduct));
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors du chargement des produits', error: error.message });
  }
});

router.get('/products/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Produit introuvable' });
    res.json(normalizeProduct(result.rows[0]));
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors du chargement du produit', error: error.message });
  }
});

router.put('/products/:id', async (req, res) => {
  try {
    const allowed = ['name', 'description', 'sport', 'category', 'brand', 'price', 'discount', 'stock', 'sizes', 'images'];
    const entries = Object.entries(req.body).filter(([key]) => allowed.includes(key));
    if (!entries.length) return res.status(400).json({ message: 'Aucune donnee a modifier' });

    const fields = entries.map(([key], index) => `${key} = $${index + 1}`).join(', ');
    const values = entries.map(([key, value]) => (['sizes', 'images'].includes(key) ? JSON.stringify(value) : value));
    values.push(req.params.id);
    
    await pool.query(`UPDATE products SET ${fields} WHERE id = $${values.length}`, values);
    res.json({ message: 'Produit modifie avec succes' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la modification du produit', error: error.message });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ message: 'Produit supprime avec succes' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la suppression du produit', error: error.message });
  }
});

router.get('/categories', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.name, c.icon, COUNT(p.id) AS products
       FROM categories c
       LEFT JOIN products p ON p.sport = c.name
       GROUP BY c.id, c.name, c.icon
       ORDER BY c.name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors du chargement des categories', error: error.message });
  }
});

router.post('/orders', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, total, status = 'pending', items = [] } = req.body;
    await client.query('BEGIN');

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, total, status) VALUES ($1, $2, $3) RETURNING id',
      [user_id || null, total, status]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [orderId, item.product_id, item.quantity, item.price]
      );
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.product_id]);
    }

    await client.query('COMMIT');
    res.status(201).json({ id: orderId, user_id, total, status, items });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Erreur lors de la creation de la commande', error: error.message });
  } finally {
    client.release();
  }
});

router.get('/orders', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors du chargement des commandes', error: error.message });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const ordersResult = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!ordersResult.rows.length) return res.status(404).json({ message: 'Commande introuvable' });
    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [req.params.id]);
    res.json({ ...ordersResult.rows[0], items: itemsResult.rows });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors du chargement de la commande', error: error.message });
  }
});

router.get('/stats', async (_req, res) => {
  try {
    const productStatsResult = await pool.query('SELECT COUNT(*) AS total_products FROM products');
    const salesStatsResult = await pool.query("SELECT COALESCE(SUM(total), 0) AS total_sales FROM orders WHERE status != 'cancelled'");
    const categoryStatsResult = await pool.query(
      `SELECT p.sport AS best_category, COUNT(oi.id) AS sales
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       GROUP BY p.sport
       ORDER BY sales DESC
       LIMIT 1`
    );
    const productBestResult = await pool.query(
      `SELECT p.name AS best_product, SUM(oi.quantity) AS sold
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       GROUP BY p.id, p.name
       ORDER BY sold DESC
       LIMIT 1`
    );

    res.json({
      total_products: Number(productStatsResult.rows[0].total_products || 0),
      total_sales: Number(salesStatsResult.rows[0].total_sales || 0),
      best_category: categoryStatsResult.rows[0]?.best_category || null,
      best_product: productBestResult.rows[0]?.best_product || null,
    });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors du chargement des statistiques', error: error.message });
  }
});

export default router;
