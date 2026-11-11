/**
 * Consistent JSON API response format:
 * {
 *   "data": {},
 *   "meta": {},
 *   "error": null
 * }
 */
export const ok = (res, data, meta = {}, status = 200) => {
  return res.status(status).json({
    data: data !== undefined ? data : null,
    meta: meta || {},
    error: null
  });
};

export const fail = (res, message, details = [], status = 400) => {
  return res.status(status).json({
    data: null,
    meta: {},
    error: {
      status,
      message,
      details: Array.isArray(details) ? details : [details]
    }
  });
};
