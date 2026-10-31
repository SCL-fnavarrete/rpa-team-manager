import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// check:theme solo detecta una lista corta de colores; los pasteles de Día (#fff7e6, #f9f0ff, #f6ffed) se le escapaban
// y dejaban cajas claras en modo Noche. Aquí se exige que los componentes del cotizador no quemen ningún color.
// Vitest corre desde frontend/ (jsdom no entrega import.meta.url como archivo)
const dir = resolve(process.cwd(), 'src/components/scoping');
const files = readdirSync(dir).filter((name) => name.endsWith('.tsx'));

describe('colores de los componentes del cotizador', () => {
  it('encuentra los componentes a revisar', () => {
    expect(files).toEqual(expect.arrayContaining([
      'DiscoveryWizard.tsx',
      'LiveScoringSidebar.tsx',
      'ScopingListTable.tsx',
      'TechnicalEconomicProposalModal.tsx'
    ]));
  });

  it.each(files)('%s no quema colores hexadecimales (salvo la detección de modo Noche de la especificación)', (name) => {
    const source = readFileSync(resolve(dir, name), 'utf8');
    const offenders = source
      .split('\n')
      // La especificación de UI exige estas comparaciones con los tokens oscuros para detectar el modo Noche
      .filter((line) => !/token\.colorBg\w+\s*===/.test(line))
      .flatMap((line) => line.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []);

    expect(offenders).toEqual([]);
  });
});
