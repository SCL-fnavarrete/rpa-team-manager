import { RPA_ARCHETYPES } from '../../constants/rpaArchetypes';
import { ScopingCalculationEngine, ScopingInputs } from '../../services/scopingCalculationEngine';

describe('RPA_ARCHETYPES', () => {
    it('define los 6 arquetipos del plan con ids únicos', () => {
        const ids = RPA_ARCHETYPES.map((a) => a.id);

        expect(ids).toHaveLength(6);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(
            expect.arrayContaining([
                'conciliacion_bancaria',
                'contabilizacion_facturas',
                'recepcion_ordenes_compra',
                'descarga_portales_web',
                'carga_masiva_datos',
                'custom'
            ])
        );
    });

    it.each(RPA_ARCHETYPES.map((a) => [a.id, a] as const))(
        '%s trae textos y preguntas guía completas',
        (_id, archetype) => {
            expect(archetype.name.trim()).not.toBe('');
            expect(archetype.description.trim()).not.toBe('');
            expect(archetype.recommended_questions.length).toBeGreaterThan(0);
            archetype.recommended_questions.forEach((q) => expect(q.trim()).not.toBe(''));
        }
    );

    it.each(RPA_ARCHETYPES.map((a) => [a.id, a] as const))(
        '%s calcula sin NaN usando solo sus default_inputs',
        (_id, archetype) => {
            const result = ScopingCalculationEngine.calculate(archetype.default_inputs as ScopingInputs);

            const numericFields = [
                result.annual_manual_hours,
                result.hours_saved_annual,
                result.estimated_weeks,
                result.total_hours,
                result.hours_pm,
                result.hours_consultant,
                result.hours_developer,
                result.hours_advisor
            ];
            numericFields.forEach((value) => {
                expect(Number.isFinite(value)).toBe(true);
                expect(value).toBeGreaterThanOrEqual(0);
            });
            expect(result.total_hours).toBe(
                result.hours_pm + result.hours_consultant + result.hours_developer + result.hours_advisor
            );
        }
    );
});
