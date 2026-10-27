// tests/helpers/scriptedTx.ts
// Exécuteur SQL « scénarisé » pour tester un service sans base : chaque requête
// émise doit correspondre, dans l'ordre, à la ligne suivante du scénario (fragment
// de SQL attendu → réponse). Contrairement à une suite de mockResolvedValueOnce
// anonymes, un écart (requête en trop, manquante, ou dans le mauvais ordre) échoue
// avec un message qui dit laquelle.
export type Expect = [fragment: string, result: any];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export const rows = (r: any[]): [any[], any[]] => [r, []];
export const ok = (o: Record<string, any> = {}): [any, any[]] => [{ affectedRows: 1, insertId: 0, ...o }, []];

export function scriptedTx(script: Expect[]) {
    let i = 0;
    const execute = jest.fn(async (sql: string, _values?: any[]) => {
        const exp = script[i];
        if (!exp) throw new Error(`Unexpected extra query #${i + 1}: ${norm(sql).slice(0, 140)}`);
        i += 1;
        const [fragment, result] = exp;
        if (!norm(sql).includes(fragment)) {
            throw new Error(`Query #${i} should contain «${fragment}» but was: ${norm(sql).slice(0, 160)}`);
        }
        return result;
    });
    return {
        tx: { execute, query: execute } as any,
        /** Échoue si le scénario n'a pas été consommé jusqu'au bout. */
        done: () => expect(i).toBe(script.length),
        calls: execute.mock.calls as any[][],
        /** Paramètres de la n-ième requête (1-based). */
        params: (n: number) => execute.mock.calls[n - 1][1] as any[],
    };
}
