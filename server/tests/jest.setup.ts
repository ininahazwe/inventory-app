// tests/jest.setup.ts
// Active les mocks manuels globalement — aucun test d'intégration ne touche une
// vraie base MySQL, un vrai JWT Google, ou un vrai envoi Gmail.
jest.mock('../src/database/connection');
jest.mock('../src/middleware/auth');
jest.mock('../src/services/gmailService');
