/**
 * ESLint rule: require-org-isolation
 *
 * Warns when Prisma findUnique/findFirst is used with an ID parameter
 * but the function doesn't contain organization isolation check patterns.
 *
 * This is a heuristic rule - it may have false positives but helps catch
 * potential IDOR vulnerabilities early.
 */

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Warn about potential missing organization isolation checks',
      category: 'Security',
      recommended: true
    },
    messages: {
      missingOrgCheck: 'SECURITY: Prisma query fetches by ID but function lacks org isolation check. See SECURITY_GUIDELINES.md for patterns.',
    },
    schema: []
  },

  create(context) {
    // Stack of function contexts (for nested functions)
    const functionStack = [];

    const ORG_CHECK_PATTERNS = [
      'organizationId',
      'requireOrgIsolation',
      'requireDealAccess',
      'fetchWithOrgCheck'
    ];

    function getCurrentFunction() {
      return functionStack.length > 0 ? functionStack[functionStack.length - 1] : null;
    }

    function enterFunction(node) {
      functionStack.push({
        node,
        hasOrgCheck: false,
        queries: []
      });
    }

    function exitFunction(node) {
      const ctx = getCurrentFunction();
      if (ctx && ctx.node === node) {
        // At function exit, report any queries in functions without org checks
        if (!ctx.hasOrgCheck && ctx.queries.length > 0) {
          for (const query of ctx.queries) {
            context.report({
              node: query,
              messageId: 'missingOrgCheck'
            });
          }
        }
        functionStack.pop();
      }
    }

    return {
      // Track function entry
      FunctionDeclaration(node) { enterFunction(node); },
      FunctionExpression(node) { enterFunction(node); },
      ArrowFunctionExpression(node) { enterFunction(node); },

      // Track function exit
      'FunctionDeclaration:exit'(node) { exitFunction(node); },
      'FunctionExpression:exit'(node) { exitFunction(node); },
      'ArrowFunctionExpression:exit'(node) { exitFunction(node); },

      // Check for org isolation patterns in the code
      Identifier(node) {
        const ctx = getCurrentFunction();
        if (ctx && ORG_CHECK_PATTERNS.includes(node.name)) {
          ctx.hasOrgCheck = true;
        }
      },

      MemberExpression(node) {
        const ctx = getCurrentFunction();
        if (ctx && node.property?.name === 'organizationId') {
          ctx.hasOrgCheck = true;
        }
      },

      // Check Prisma queries
      CallExpression(node) {
        const ctx = getCurrentFunction();
        if (!ctx) return;

        // Look for prisma.model.findUnique or prisma.model.findFirst
        if (
          node.callee?.type === 'MemberExpression' &&
          node.callee.property?.type === 'Identifier' &&
          ['findUnique', 'findFirst'].includes(node.callee.property.name)
        ) {
          // Check if the query has a where clause with an id field
          const args = node.arguments[0];
          if (args?.type === 'ObjectExpression') {
            const whereProperty = args.properties.find(
              p => p.key?.name === 'where'
            );

            if (whereProperty?.value?.type === 'ObjectExpression') {
              const hasIdField = whereProperty.value.properties.some(
                p => p.key?.name === 'id' || p.key?.type === 'Identifier'
              );

              // Check if include: { deal: true } is present (suggests org check will follow)
              const includeProperty = args.properties.find(
                p => p.key?.name === 'include'
              );

              const hasDealInclude = includeProperty?.value?.properties?.some(
                p => p.key?.name === 'deal'
              );

              // If querying by ID, record it (unless it has deal include which implies awareness)
              if (hasIdField && !hasDealInclude) {
                ctx.queries.push(node);
              }
            }
          }
        }
      }
    };
  }
};
