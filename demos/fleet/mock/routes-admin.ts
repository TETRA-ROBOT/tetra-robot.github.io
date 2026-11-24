/**
 * 시스템 관리 화면(AI 연결·백업·HTTPS·업데이트·외부 연동)이 처음 읽는 값. 데모에서는 보기만 되고 바꾸기는 막는다.
 */
import { demoOnly, get, post, put } from './router';
import { alerts, auditLogs, iso, maps, missions, pois, robots, users } from './state';

get('/api/fleet/ai/status', () => ({
  cli_installed: false,
  credential_source: 'NONE',
  cli_status: null,
  login_pending: false,
  model: 'claude-sonnet',
  code_proposals_available: false,
  provider: 'CONSOLE',
  claude_code: { available: false, cli_installed: false, model: null, login: null },
}));
get('/api/fleet/ai/actions', () => []);
get('/api/fleet/ai/proposals', () => []);
get('/api/fleet/ai/conversations', () => []);
for (const p of ['/api/fleet/ai/chat', '/api/fleet/ai/login/start', '/api/fleet/ai/login/finish', '/api/fleet/ai/verify']) post(p, () => demoOnly('AI 연결'));
put('/api/fleet/ai/provider', () => demoOnly('AI 연결'));

get('/api/fleet/database/summary', () => {
  const tables = [
    { tableName: 'robots', modelName: 'Robot', label: '로봇', description: '등록한 로봇', icon: 'mdi-robot', category: 'robot', count: robots.filter((r) => !r.is_virtual).length },
    { tableName: 'maps', modelName: 'Map', label: '지도', description: '구역 지도 버전', icon: 'mdi-map', category: 'core', count: maps.length },
    { tableName: 'locations', modelName: 'Location', label: '장소', description: '지도 위 장소', icon: 'mdi-map-marker', category: 'core', count: pois.length },
    { tableName: 'missions', modelName: 'Mission', label: '미션', description: '미션 기록', icon: 'mdi-clipboard-list', category: 'operation', count: missions.length },
    { tableName: 'alerts', modelName: 'Alert', label: '알림', description: '알림 기록', icon: 'mdi-bell', category: 'operation', count: alerts.length },
    { tableName: 'audit_logs', modelName: 'AuditLog', label: '조작 이력', description: '누가 무엇을 했는지', icon: 'mdi-history', category: 'operation', count: auditLogs.length },
    { tableName: 'users', modelName: 'User', label: '사용자', description: '관제 계정', icon: 'mdi-account', category: 'core', count: users.length },
  ];
  return { dbFileSize: 2_480_128, dbFileModified: iso(), totalTables: tables.length, totalRecords: tables.reduce((a, t) => a + t.count, 0), tables };
});
get('/api/fleet/database/backups', () => [{ filename: 'backup_full_db_20261120_0300.json', size: 1_204_331, createdAt: iso(Date.now() - 4 * 86_400_000), type: 'full', totalRecords: 1820 }]);
post('/api/fleet/database/backups', () => demoOnly('백업'));
post('/api/fleet/database/restore-upload', () => demoOnly('복원'));
post('/api/fleet/database/backups/:file/restore', () => demoOnly('복원'));

get('/api/fleet/system/https', () => ({ enabled: false, mode: 'OFF', port: 443, cert: null, problem: null, ca_available: false, auto_restart: false, local_names: ['localhost'] }));
put('/api/fleet/system/https', () => demoOnly('HTTPS 설정'));
post('/api/fleet/system/https', () => demoOnly('HTTPS 설정'));

get('/api/fleet/system/update', () => ({
  installType: 'other',
  autoRestart: false,
  version: null,
  release: { version: '26.11.1', display: '26.11.1 · 데모', exact: true, built_at: null },
  channel: 'stable',
  activeMissions: missions.filter((m) => ['ASSIGNED', 'RUNNING', 'PAUSED'].includes(m.status)).length,
  job: { state: 'idle', message: '', startedAt: '', finishedAt: '', fromVersion: null, toVersion: null, log: [] },
}));
post('/api/fleet/system/update', () => demoOnly('소프트웨어 업데이트'));

get('/api/fleet/integrations/tokens', () => []);
get('/api/fleet/integrations/webhooks', () => []);
post('/api/fleet/integrations/tokens', () => demoOnly('외부 연동 토큰'));
post('/api/fleet/integrations/webhooks', () => demoOnly('웹훅'));
