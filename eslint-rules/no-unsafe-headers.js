/**
 * ESLint rule: no-unsafe-headers
 *
 * Prevents use of spoofable headers for authorization decisions.
 * These headers can be set by any client and should NEVER be trusted
 * for identity or role verification.
 */

const UNSAFE_HEADERS = [
  'x-actor-role',
  'x-user-id',
  'x-canonical-user-id',
  'x-debug-user-id'
];

const UNSAFE_FUNCTIONS = [
  'resolveActorRole',
  'resolveDebugUserId'
];

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow use of spoofable headers for authorization',
      category: 'Security',
      recommended: true
    },
    messages: {
      unsafeHeader: 'SECURITY: Do not use "{{header}}" header for authorization. Use authUser from validated JWT instead.',
      unsafeFunction: 'SECURITY: Do not use "{{func}}" for authorization. Use authUser.role from validated JWT instead.',
      headerAccess: 'SECURITY: Accessing req.headers["{{header}}"] is unsafe for authorization. Use authUser from validated JWT.'
    },
    schema: []
  },

  create(context) {
    return {
      // Catch: req.headers["x-actor-role"] or req.headers['x-user-id']
      MemberExpression(node) {
        // Check for req.headers[...] pattern
        if (
          node.object?.type === 'MemberExpression' &&
          node.object.property?.name === 'headers' &&
          node.computed &&
          node.property?.type === 'Literal'
        ) {
          const headerName = node.property.value?.toLowerCase?.();
          if (UNSAFE_HEADERS.includes(headerName)) {
            context.report({
              node,
              messageId: 'headerAccess',
              data: { header: headerName }
            });
          }
        }
      },

      // Catch: resolveActorRole(req) calls
      CallExpression(node) {
        if (
          node.callee?.type === 'Identifier' &&
          UNSAFE_FUNCTIONS.includes(node.callee.name)
        ) {
          context.report({
            node,
            messageId: 'unsafeFunction',
            data: { func: node.callee.name }
          });
        }
      },

      // Catch string literals containing unsafe header names in template literals
      TemplateLiteral(node) {
        node.quasis.forEach(quasi => {
          const value = quasi.value.raw.toLowerCase();
          UNSAFE_HEADERS.forEach(header => {
            if (value.includes(header)) {
              context.report({
                node: quasi,
                messageId: 'unsafeHeader',
                data: { header }
              });
            }
          });
        });
      }
    };
  }
};
