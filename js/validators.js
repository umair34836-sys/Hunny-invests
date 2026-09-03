// validators.js — reusable form validation helpers.

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

export function isValidPhone(phone) {
  // Accepts Pakistani mobile formats: 03XXXXXXXXX or +923XXXXXXXXX
  return /^(\+92|0)3\d{9}$/.test(String(phone || "").trim().replace(/[\s-]/g, ""));
}

export function isNonEmpty(value) {
  return String(value ?? "").trim().length > 0;
}

export function isPositiveNumber(value) {
  const n = Number(value);
  return !Number.isNaN(n) && n > 0;
}

export function isValidPassword(password) {
  return String(password || "").length >= 6;
}

export function minLength(value, len) {
  return String(value ?? "").trim().length >= len;
}

/**
 * Validate a set of {value, rules[]} entries.
 * rules: array of [fn, message]
 * Returns { valid, errors: {field: message} }
 */
export function validateForm(fields) {
  const errors = {};
  for (const [key, { value, rules }] of Object.entries(fields)) {
    for (const [fn, message] of rules) {
      if (!fn(value)) {
        errors[key] = message;
        break;
      }
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}
