import { isPlainObject, selectWritableColumns } from '../../utils/columnWhitelist';

const ALLOWED = ['name', 'description', 'status'] as const;

describe('selectWritableColumns', () => {
    it('devuelve las columnas de la lista blanca presentes en el cuerpo, en el orden de la lista y no en el del cliente', () => {
        const result = selectWritableColumns({ status: 'done', name: 'Hito' }, ALLOWED);

        expect(result).toEqual({ columns: ['name', 'status'], values: ['Hito', 'done'] });
    });

    it('acepta texto, número, booleano y null como valores, y omite los undefined', () => {
        const result = selectWritableColumns({ name: 'x', description: null, status: undefined }, ALLOWED);

        expect(result).toEqual({ columns: ['name', 'description'], values: ['x', null] });
        expect(selectWritableColumns({ name: 5 }, ALLOWED)).toEqual({ columns: ['name'], values: [5] });
        expect(selectWritableColumns({ name: true }, ALLOWED)).toEqual({ columns: ['name'], values: [true] });
    });

    it('rechaza toda clave fuera de la lista (coincidencia exacta, sensible a mayúsculas y espacios) y las nombra', () => {
        for (const key of ['NAME', 'Name', ' name', 'name ', 'name\n', 'id', 'name = 1, description', 'constructor', 'toString']) {
            expect(selectWritableColumns({ [key]: 1 }, ALLOWED)).toEqual({ error: `Campos no permitidos: ${key}` });
        }
        expect(selectWritableColumns({ name: 'x', a: 1, b: 2 }, ALLOWED)).toEqual({ error: 'Campos no permitidos: a, b' });
    });

    it('no refleja completa una clave hostil enorme en el mensaje de error', () => {
        const result = selectWritableColumns({ [`x${'a'.repeat(5000)}`]: 1 }, ALLOWED);

        expect(result).toEqual({ error: `Campos no permitidos: x${'a'.repeat(59)}…` });
    });

    it('rechaza una clave __proto__ propia (JSON.parse la crea como propiedad normal)', () => {
        const body = JSON.parse('{"__proto__": {"name": "hackeado"}}');

        expect(Object.keys(body)).toEqual(['__proto__']);
        expect(selectWritableColumns(body, ALLOWED)).toEqual({ error: 'Campos no permitidos: __proto__' });
    });

    it('ignora las propiedades heredadas: solo cuentan las propias del cuerpo', () => {
        const body = Object.create({ name: 'heredado' });
        body.status = 'done';

        expect(selectWritableColumns(body, ALLOWED)).toEqual({ columns: ['status'], values: ['done'] });
    });

    it('ignora sin error las claves de la lista de ignoradas pero nunca las devuelve como columnas', () => {
        const result = selectWritableColumns({ id: 9, created_by: 2, name: 'x' }, ALLOWED, ['id', 'created_by']);

        expect(result).toEqual({ columns: ['name'], values: ['x'] });
    });

    it('rechaza valores que no son escalares (objeto, arreglo, función) y nombra la columna', () => {
        expect(selectWritableColumns({ name: { $ne: 1 } }, ALLOWED)).toEqual({ error: 'Valor no válido para el campo: name' });
        expect(selectWritableColumns({ description: ['a'] }, ALLOWED)).toEqual({ error: 'Valor no válido para el campo: description' });
    });

    it('rechaza un cuerpo que no es un objeto', () => {
        for (const body of [null, undefined, 'texto', 5, [{ name: 'x' }]]) {
            expect(selectWritableColumns(body, ALLOWED)).toEqual({ error: 'El cuerpo debe ser un objeto JSON con los campos a guardar' });
        }
    });

    it('un cuerpo sin ninguna columna válida devuelve listas vacías para que el llamador responda 400', () => {
        expect(selectWritableColumns({}, ALLOWED)).toEqual({ columns: [], values: [] });
    });
});

describe('isPlainObject', () => {
    it('distingue objetos simples de arreglos, null, fechas y valores primitivos', () => {
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject(Object.create(null))).toBe(true);
        for (const value of [[], null, undefined, new Date(), 'x', 3]) expect(isPlainObject(value)).toBe(false);
    });
});
