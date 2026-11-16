export { CRED_VARS, hasCreds, missingCreds, readCreds, type Creds } from './creds.js';
export { baseUrl, connect, SourceError, type AuthMethod, type AuthSetting, type Connection, type ConnectOptions, type ErrorKind } from './http.js';
export { linkJql, linkKeys, linkedIssues, openLoad, quote, search, serverVersion, toIssue } from './jira.js';
export { pageInfo, pageRef, type PageInfo, type PageRef } from './confluence.js';
export { syncConfluence, syncJira, type ConfluenceReport, type JiraReport } from './sync.js';
export { checkSources, runSync, type CheckRow, type RunOptions, type SyncResult } from './run.js';
