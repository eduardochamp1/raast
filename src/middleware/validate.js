'use strict';
/**
 * src/middleware/validate.js
 * Middleware de validação Zod genérico.
 * Uso: router.post('/', validate(MySchema), handler)
 *      router.get('/',  validate(MySchema, 'query'), handler)
 */

/**
 * @param {import('zod').ZodSchema} schema
 * @param {'body'|'query'} source — onde buscar os dados (padrão: 'body')
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = result.error.issues.map((e) => ({
        field:   e.path.join('.') || 'input',
        message: e.message,
      }));
      return res.status(400).json({ error: 'Dados inválidos', details: errors });
    }
    // Substitui req[source] pelo valor parsed (coercions aplicadas, defaults incluídos)
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
