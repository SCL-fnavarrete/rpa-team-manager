// toString y no getPrototypeOf: las filas del driver sqlite3 vienen de otro contexto de ejecución (Jest) y su prototipo no es el nuestro
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    Object.prototype.toString.call(value) === '[object Object]';

const isScalar = (value: unknown): boolean =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value);

// El mensaje nombra las claves rechazadas, pero una clave hostil puede ser enorme: no se refleja completa
const MAX_REPORTED_KEY_LENGTH = 60;
const shorten = (key: string): string => (key.length > MAX_REPORTED_KEY_LENGTH ? `${key.slice(0, MAX_REPORTED_KEY_LENGTH)}…` : key);

export type ColumnSelection = { columns: string[]; values: unknown[] } | { error: string };

/**
 * Elige qué columnas escribir a partir del cuerpo de una petición, para armar un UPDATE o INSERT dinámico sin
 * interpolar nunca una clave del cliente en el SQL: los nombres de columna salen siempre de `allowed` (una
 * constante del servidor) y los valores van como parámetros enlazados.
 *
 * Reglas: el cuerpo debe ser un objeto; toda clave fuera de `allowed` se rechaza (coincidencia exacta, sensible a
 * mayúsculas y espacios), salvo las de `ignored`, que se descartan sin error (campos del servidor que algunos
 * clientes devuelven junto al registro); solo cuentan las propiedades propias, así que un `__proto__` heredado no
 * entra; los valores deben ser texto, número, booleano o null. Las columnas salen en el orden de `allowed`.
 * Devuelve `{ error }` en español para responder 400, o las columnas con sus valores (listas vacías si el cuerpo
 * no trae ninguna columna válida; el llamador decide qué hacer).
 */
export const selectWritableColumns = (
    body: unknown,
    allowed: readonly string[],
    ignored: readonly string[] = []
): ColumnSelection => {
    if (!isPlainObject(body)) return { error: 'El cuerpo debe ser un objeto JSON con los campos a guardar' };

    const accepted = new Set<string>([...allowed, ...ignored]);
    const notAllowed = Object.keys(body).filter(key => !accepted.has(key));
    if (notAllowed.length > 0) return { error: `Campos no permitidos: ${notAllowed.map(shorten).join(', ')}` };

    const columns = allowed.filter(column => Object.prototype.hasOwnProperty.call(body, column) && body[column] !== undefined);
    const invalid = columns.find(column => !isScalar(body[column]));
    if (invalid) return { error: `Valor no válido para el campo: ${invalid}` };

    return { columns, values: columns.map(column => body[column]) };
};
