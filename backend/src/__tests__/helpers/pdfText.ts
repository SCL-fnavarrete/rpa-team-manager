import { execFile } from 'child_process';

// pdf-parse (pdfjs) no arranca dentro de la VM de jest ("dynamic import callback ... --experimental-vm-modules"),
// así que el texto se extrae en un proceso node aparte, que recibe los PDF en base64 por stdin.
const EXTRACT_SCRIPT = `
const { PDFParse } = require(process.argv[1]);
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
    const texts = [];
    for (const base64 of JSON.parse(input)) {
        const parser = new PDFParse({ data: new Uint8Array(Buffer.from(base64, 'base64')) });
        try { texts.push((await parser.getText({ lineEnforce: true })).text); } finally { await parser.destroy(); }
    }
    process.stdout.write(JSON.stringify(texts));
});
`;

/**
 * Líneas de texto visibles de cada PDF, en orden de lectura: una línea por fila visual,
 * de modo que una celda partida en dos renglones aparece como una línea aparte.
 */
export function extractPdfLines(pdfs: Buffer[]): Promise<string[][]> {
    return new Promise((resolve, reject) => {
        const child = execFile(
            process.execPath, ['-e', EXTRACT_SCRIPT, require.resolve('pdf-parse')],
            { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) return reject(new Error(`No se pudo extraer el texto del PDF: ${stderr || error.message}`));
                const texts: string[] = JSON.parse(stdout);
                resolve(texts.map(text => text.split('\n').map(line => line.trim()).filter(Boolean)));
            }
        );
        child.stdin!.end(JSON.stringify(pdfs.map(pdf => pdf.toString('base64'))));
    });
}
