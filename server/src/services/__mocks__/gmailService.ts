// src/services/__mocks__/gmailService.ts
// Mock manuel (jest.mock('../../src/services/gmailService')) — aucun vrai envoi Gmail
// pendant les tests (évite un appel réseau réel + credentials OAuth manquants en sandbox).
export const sendEmail = jest.fn().mockResolvedValue(true);

const stubPayload = () => ({ to: 'test@mfwa.org', subject: 'test', html: '<p>test</p>' });

export const getBidderConfirmationEmail = jest.fn(stubPayload);
export const getCreatorNotificationEmail = jest.fn(stubPayload);
export const getOutbidNotificationEmail = jest.fn(stubPayload);
export const getWinnerNotificationEmail = jest.fn(stubPayload);
export const getIncidentCreatedAdminEmail = jest.fn(stubPayload);
export const getIncidentResolvedEmail = jest.fn(stubPayload);
export const getIncidentSLAReminderEmail = jest.fn(stubPayload);
export const getLoanRequestedAdminEmail = jest.fn(stubPayload);
export const getLoanDecisionEmail = jest.fn(stubPayload);
export const getLoanOverdueReminderEmail = jest.fn(stubPayload);
export const getLoanReturnedEmail = jest.fn(stubPayload);
export const getLoanPickupReminderEmail = jest.fn(stubPayload);
export const getLoanAutoCancelledEmail = jest.fn(stubPayload);
