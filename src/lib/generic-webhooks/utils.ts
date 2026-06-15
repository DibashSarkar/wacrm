/**
 * Generic Webhooks Utility Helpers
 */

export interface WebhookCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists' | 'not_exists';
  value: string;
}

export interface WebhookMapping {
  type: 'payload' | 'static';
  value: string;
}

/**
 * Resolves a nested key in a JSON object using dot notation.
 * e.g., getNestedValue({ customer: { name: 'John' } }, 'customer.name') => 'John'
 */
export function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Flattens a nested JSON object into a list of dotted paths.
 * e.g., { a: { b: 1 } } => ['a.b']
 */
export function extractJsonPaths(obj: any, prefix = ''): string[] {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== 'object') return [];
  
  let paths: string[] = [];
  
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    
    // Check if the current value is a nested non-array object
    if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      paths.push(...extractJsonPaths(obj[key], path));
    } else {
      paths.push(path);
    }
  }
  
  return paths;
}

/**
 * Evaluates whether an incoming payload matches the specified conditions.
 */
export function evaluateConditions(
  payload: any,
  conditions: WebhookCondition[],
  matchType: 'all' | 'any' = 'all'
): boolean {
  if (!conditions || conditions.length === 0) return true;
  
  const results = conditions.map((cond) => {
    const val = getNestedValue(payload, cond.field);
    const target = cond.value;
    
    switch (cond.operator) {
      case 'equals':
        return String(val) === String(target);
      case 'not_equals':
        return String(val) !== String(target);
      case 'contains':
        return val !== undefined && val !== null && String(val).toLowerCase().includes(String(target).toLowerCase());
      case 'not_contains':
        return val === undefined || val === null || !String(val).toLowerCase().includes(String(target).toLowerCase());
      case 'exists':
        return val !== undefined && val !== null;
      case 'not_exists':
        return val === undefined || val === null;
      default:
        return false;
    }
  });
  
  if (matchType === 'any') {
    return results.some((r) => r === true);
  }
  return results.every((r) => r === true);
}

/**
 * Resolves template parameter mappings against an incoming payload.
 */
export function resolveMapping(payload: any, mapping: WebhookMapping): string {
  if (!mapping) return '';
  if (mapping.type === 'static') {
    return mapping.value;
  }
  const val = getNestedValue(payload, mapping.value);
  return val !== undefined && val !== null ? String(val) : '';
}
