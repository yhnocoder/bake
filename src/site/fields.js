const allowedKeys = new Set(['label', 'type', 'default', 'min', 'max', 'step', 'options']);
const baseTypes = ['number', 'string', 'boolean', 'enum'];
const numberKeys = ['min', 'max', 'step'];

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function defaultError(field) {
  const value = field.default;
  switch (field.type) {
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return 'default must be a number';
      if ((typeof field.min === 'number' && value < field.min) || (typeof field.max === 'number' && value > field.max)) return 'default must be between min and max';
      return null;
    case 'string':
      return typeof value === 'string' ? null : 'default must be a string';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'default must be true or false';
    case 'enum':
      return isStringList(field.options) && !field.options.includes(value) ? `default must be one of ${field.options.join(', ')}` : null;
    case 'list':
      return isStringList(value) ? null : 'default must be a list of strings';
    default:
      return null;
  }
}

function fieldErrors(field, types) {
  if (!isObject(field)) return ['definition must be an object'];
  const errors = [];
  for (const key of Object.keys(field)) {
    if (!allowedKeys.has(key)) errors.push(`unknown key ${key}`);
  }
  if (!types.includes(field.type)) {
    errors.push(`type must be one of ${types.join(', ')}`);
    return errors;
  }
  if (field.label !== undefined && typeof field.label !== 'string') errors.push('label must be a string');
  if (field.type === 'enum') {
    if (!isStringList(field.options) || field.options.length === 0) errors.push('enum requires options, a non-empty list of strings');
  } else if (field.options !== undefined) {
    errors.push('options is only allowed for enum');
  }
  for (const key of numberKeys) {
    if (field[key] === undefined) continue;
    if (field.type !== 'number') errors.push(`${key} is only allowed for number`);
    else if (typeof field[key] !== 'number' || Number.isNaN(field[key])) errors.push(`${key} must be a number`);
  }
  if (typeof field.min === 'number' && typeof field.max === 'number' && field.min > field.max) errors.push('min must not be greater than max');
  if (field.default !== undefined) {
    const error = defaultError(field);
    if (error) errors.push(error);
  }
  return errors;
}

export function checkFields(fields, { allowList = false } = {}) {
  const noun = allowList ? 'Field' : 'Property';
  if (!isObject(fields)) return [`${noun} definitions must be an object`];
  const types = allowList ? [...baseTypes, 'list'] : baseTypes;
  return Object.entries(fields).flatMap(([name, field]) => fieldErrors(field, types).map((error) => `${noun} ${name}: ${error}`));
}
