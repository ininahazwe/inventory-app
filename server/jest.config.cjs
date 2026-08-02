module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: 'tsconfig.test.json',
        }],
    },
    // Active les mocks manuels (src/**/__mocks__) pour tous les tests: DB, auth, email —
    // aucun test n'appelle une vraie base MySQL ni un vrai envoi Gmail.
    setupFiles: ['<rootDir>/tests/jest.setup.ts'],
    // Exécute les suites en série: sur une machine/CI contraint en mémoire,
    // le mode parallèle par défaut peut tuer le process worker (OOM/SIGKILL).
    // La suite reste rapide (peu de fichiers, pas de vraie I/O réseau/DB).
    maxWorkers: 1,
};