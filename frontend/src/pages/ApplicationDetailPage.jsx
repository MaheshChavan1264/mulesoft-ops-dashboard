import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy, Clock, Database, Server, Settings, Globe } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import api from '../services/api';

const PRow = ({ label, value, mono = true, hi }) => (
  <div className={`flex items-start px-4 py-2.5 rounded-lg mb-1 transition-colors ${hi ? 'bg-blue-500/5 border border-blue-500/15' : 'bg-gray-800/30 hover:bg-gray-800/60'}`}>
    <span className="text-gray-400 text-xs uppercase tracking-wider w-48 flex-shrink-0 pt-0.5 font-medium">{label}</span>
    <span className={`text-white text-sm break-all ${mono ? 'font-mono' : ''}`}>{value ?? <span className="text-gray-600">—</span>}</span>
  </div>
);

const Sec = ({ icon: Icon, title, count, accent, children }) => (
  <div className={`rounded-xl border overflow-hidden ${accent ? 'border-blue-500/25 bg-blue-500/5' : 'border-gray-700/50 bg-gray-800/20'}`}>
    <div className={`flex items-center gap-2.5 px-5 py-3.5 border-b ${accent ? 'border-blue-500/20 bg-blue-500/10' : 'border-gray-700/40 bg-gray-800/40'}`}>
      {Icon && <Icon size={14} className={accent ? 'text-blue-400' : 'text-gray-400'} />}
      <h4 className="text-white font-semibold text-sm">{title}</h4>
      {count != null && <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${count > 0 ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-500'}`}>{count}</span>}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

export default function ApplicationDetailPage() {
  const { orgId: authOrgId } = useAuth();
  const { orgId: paramOrgId, envId, appId } = useParams();
  const orgId = paramOrgId || authOrgId;
  const navigate = useNavigate();
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (orgId && envId && appId) load(); }, [orgId, envId, appId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/applications/cloudhub2/${orgId}/${envId}/${appId}`);
      setApp(res.data);
    } catch {
      try {
        const res2 = await api.get(`/applications/cloudhub1/${envId}/${appId}`, { params: { orgId } });
        const c = res2.data;
        let ch1Schedules = [];
        try {
          const sr = await api.get(`/applications/cloudhub1/${envId}/${appId}/schedules`, { params: { orgId } });
          ch1Schedules = Array.isArray(sr.data) ? sr.data : (sr.data?.schedules || []);
        } catch {}
        setApp({ _type: 'ch1', id: c.domain, name: c.domain, status: c.status, region: c.region,
          muleVersion: c.muleVersion?.version, lastModifiedDate: c.lastUpdateTime ? new Date(c.lastUpdateTime).toISOString() : null,
          properties: c.properties || {}, persistentQueues: c.persistentQueues, staticIPsEnabled: c.staticIPsEnabled,
          loggingCustomLog4JEnabled: c.loggingCustomLog4JEnabled, monitoringEnabled: c.monitoringEnabled,
          workers: { amount: c.workers?.amount, type: c.workers?.type }, _ch1Schedules: ch1Schedules, _raw: c });
      } catch { setApp(null); }
    }
    setLoading(false);
  };

  const copyJson = () => { navigator.clipboard.writeText(JSON.stringify(app, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>;

  if (!app) return (
    <div className="space-y-4">
      <button onClick={() => navigate('/applications')} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm"><ArrowLeft size={16} /> Back</button>
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-8 text-center text-red-400">Application not found or access denied.</div>
    </div>
  );

  const ds = app.target?.deploymentSettings || {};
  const appCfg = app.application?.configuration || {};
  const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
  const schedSvc = appCfg['mule.agent.scheduling.service'] || {};
  const runtimeProps = propsSvc.properties || {};
  const secureProps = propsSvc.secureProperties || {};
  const isCH1 = app._type === 'ch1';
  const schedulers = isCH1 ? (app._ch1Schedules || []) : (schedSvc.schedulers || []);
  const httpInbound = ds.http?.inbound || {};
  const endpoints = httpInbound.endpoints || [];
  const envVars = ds.environmentVariables || ds.environmentVars || {};
  const replicas = app.target?.replicas ?? ds.replicas;
  const osEnabled = ds.persistentObjectStore ?? ds.hasPersistentObjectStore ?? false;
  const replicaList = app.replicas || [];
  const hasProps = Object.keys(runtimeProps).length > 0 || Object.keys(ds.properties || {}).length > 0
    || Object.keys(envVars).length > 0 || Object.keys(app.properties || {}).length > 0;

  const tabs = ['overview', 'properties', 'infrastructure', 'raw'];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/applications')} className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800 transition-colors"><ArrowLeft size={18} /></button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">{app.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${isCH1 ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>{isCH1 ? 'CH1' : 'CH2'}</span>
            </div>
            <p className="text-gray-500 text-xs mt-0.5">
              {isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'}
              {app.application?.ref && ` · ${app.application.ref.artifactId} v${app.application.ref.version}`}
              {app.id && ` · ${app.id}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={app.application?.status || app.status} />
          <button onClick={load} className="text-gray-400 hover:text-white bg-gray-800 p-2 rounded-lg hover:bg-gray-700 transition-colors"><RefreshCw size={14} /></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800/60 border border-gray-700/50 p-1 rounded-xl w-fit">
        {tabs.map((t) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${activeTab === t ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}>
            {t === 'infrastructure' ? 'Infra & Config' : t}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Sec icon={Server} title="General" accent>
            <PRow label="App ID" value={app.id} />
            <PRow label="Name" value={app.name} mono={false} />
            {isCH1 ? (<>
              <PRow label="Status" value={app.status} hi />
              <PRow label="Mule Version" value={app.muleVersion} />
              <PRow label="Region" value={app.region} />
              <PRow label="Workers" value={app.workers?.amount != null ? String(app.workers.amount) : undefined} />
              <PRow label="Worker Type" value={app.workers?.type?.name || (typeof app.workers?.type === 'string' ? app.workers.type : undefined)} />
            </>) : (<>
              <PRow label="Runtime Status" value={app.application?.status} hi />
              <PRow label="Desired State" value={app.application?.desiredState} />
              <PRow label="Deployment Status" value={app.status} />
              <PRow label="Mule Version" value={ds.runtime?.version || ds.runtimeVersion} />
              <PRow label="Java" value={ds.runtime?.java ? `Java ${ds.runtime.java}` : undefined} />
              <PRow label="Release Channel" value={ds.runtime?.releaseChannel} />
              <PRow label="vCores" value={app.application?.vCores != null ? String(app.application.vCores) : undefined} />
              <PRow label="Replicas" value={replicas != null ? String(replicas) : undefined} />
              <PRow label="Update Strategy" value={typeof ds.updateStrategy === 'string' ? ds.updateStrategy : undefined} />
              <PRow label="Artifact" value={app.application?.ref ? `${app.application.ref.artifactId} v${app.application.ref.version}` : undefined} />
            </>)}
            <PRow label="Last Modified" value={app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleString() : undefined} />
          </Sec>

          {replicaList.length > 0 && (
            <Sec icon={Server} title="Replica Instances" count={replicaList.length}>
              <div className="space-y-2">
                {replicaList.map((r) => (
                  <div key={r.id} className="flex items-center justify-between bg-gray-900/60 border border-gray-700/40 rounded-lg px-4 py-2.5 gap-3">
                    <span className="text-gray-300 text-xs font-mono truncate">{r.id}</span>
                    <StatusBadge status={r.state} />
                  </div>
                ))}
              </div>
            </Sec>
          )}
        </div>
      )}

      {/* PROPERTIES */}
      {activeTab === 'properties' && (
        <div className="space-y-5">
          {Object.keys(runtimeProps).length > 0 && (
            <Sec icon={Settings} title="Runtime Properties" count={Object.keys(runtimeProps).length} accent>
              <p className="text-gray-600 text-xs mb-3 font-mono">application.configuration["mule.agent.application.properties.service"]</p>
              {Object.entries(runtimeProps).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => <PRow key={k} label={k} value={String(v)} />)}
              {Object.keys(secureProps).length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-700/50">
                  <p className="text-xs text-orange-400/80 uppercase tracking-wider mb-3 font-medium">⚠ Secure Properties (redacted)</p>
                  {Object.entries(secureProps).map(([k, v]) => <PRow key={k} label={k} value={String(v)} />)}
                </div>
              )}
            </Sec>
          )}
          {Object.keys(ds.properties || {}).length > 0 && (
            <Sec icon={Settings} title="Deployment Properties" count={Object.keys(ds.properties).length}>
              {Object.entries(ds.properties).map(([k, v]) => <PRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />)}
            </Sec>
          )}
          {Object.keys(envVars).length > 0 && (
            <Sec icon={Settings} title="Environment Variables" count={Object.keys(envVars).length}>
              {Object.entries(envVars).map(([k, v]) => <PRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />)}
            </Sec>
          )}
          {Object.keys(app.properties || {}).length > 0 && (
            <Sec icon={Settings} title="Application Properties" count={Object.keys(app.properties).length}>
              {Object.entries(app.properties).map(([k, v]) => <PRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />)}
            </Sec>
          )}
          {!hasProps && (
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-5 py-4 text-sm text-yellow-400/80">
              No properties found via API. File-based and secure properties are not exposed. Check the <strong>Raw</strong> tab.
            </div>
          )}
        </div>
      )}

      {/* INFRASTRUCTURE */}
      {activeTab === 'infrastructure' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Sec icon={Server} title="Resources" accent>
              {!isCH1 ? (<>
                <PRow label="vCores" value={app.application?.vCores != null ? String(app.application.vCores) : undefined} />
                <PRow label="Replicas" value={replicas != null ? String(replicas) : undefined} />
                <PRow label="Update Strategy" value={typeof ds.updateStrategy === 'string' ? ds.updateStrategy : undefined} />
                <PRow label="Clustered" value={ds.clustered != null ? String(ds.clustered) : undefined} />
                <PRow label="Spread Replicas" value={ds.enforceDeployingReplicasAcrossNodes != null ? String(ds.enforceDeployingReplicasAcrossNodes) : undefined} />
                <PRow label="JVM Args" value={ds.jvm?.args || '(none)'} />
                <PRow label="Tracing" value={ds.tracingEnabled != null ? String(ds.tracingEnabled) : undefined} />
              </>) : (<>
                <PRow label="Workers" value={app.workers?.amount != null ? String(app.workers.amount) : undefined} />
                <PRow label="Worker Type" value={app.workers?.type?.name || (typeof app.workers?.type === 'string' ? app.workers.type : undefined)} />
                <PRow label="Worker Memory" value={app.workers?.type?.memory} />
              </>)}
            </Sec>

            <Sec icon={Database} title="Object Store">
              <PRow label="Persistent Object Store" value={osEnabled ? '✅ Enabled' : '❌ Disabled'} mono={false} />
              {isCH1 && <PRow label="Persistent Queues" value={app.persistentQueues != null ? String(app.persistentQueues) : undefined} />}
              {isCH1 && <PRow label="Monitoring" value={app.monitoringEnabled != null ? String(app.monitoringEnabled) : undefined} />}
              {isCH1 && <PRow label="Custom Log4j" value={app.loggingCustomLog4JEnabled != null ? String(app.loggingCustomLog4JEnabled) : undefined} />}
              {isCH1 && <PRow label="Static IPs" value={app.staticIPsEnabled != null ? String(app.staticIPsEnabled) : undefined} />}
            </Sec>
          </div>

          {/* Schedulers */}
          <Sec icon={Clock} title="Schedulers" count={schedulers.length}>
            {schedulers.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {schedulers.map((s, i) => (
                  <div key={i} className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-4 hover:border-gray-600/50 transition-colors">
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-white text-sm font-semibold font-mono leading-tight">{s.flowName || s.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-2 flex-shrink-0 ${s.enabled !== false ? 'bg-green-500/20 text-green-400' : 'bg-gray-600/30 text-gray-400'}`}>
                        {s.enabled !== false ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="space-y-2 text-xs">
                      {s.type && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 w-20 flex-shrink-0">Type</span>
                          <span className="text-gray-300 bg-gray-800 px-2 py-0.5 rounded">{s.type}</span>
                        </div>
                      )}
                      {/* CH1 cron */}
                      {s.cronExpression && (
                        <div className="flex items-start gap-2">
                          <span className="text-gray-500 w-20 flex-shrink-0 pt-0.5">Cron</span>
                          <code className="text-cyan-400 bg-cyan-900/20 border border-cyan-900/30 px-2 py-1 rounded font-mono text-xs break-all">{s.cronExpression}</code>
                        </div>
                      )}
                      {/* CH1 fixed frequency */}
                      {s.frequency && !s.cronExpression && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 w-20 flex-shrink-0">Frequency</span>
                          <span className="text-white font-mono bg-gray-800 px-2 py-0.5 rounded">{s.frequency} {s.timeUnit}</span>
                        </div>
                      )}
                      {s.startDelay && s.startDelay !== '0' && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 w-20 flex-shrink-0">Start Delay</span>
                          <span className="text-white font-mono bg-gray-800 px-2 py-0.5 rounded">{s.startDelay} {s.timeUnit}</span>
                        </div>
                      )}
                      {/* CH2 expression */}
                      {s.expression && (
                        <div className="flex items-start gap-2">
                          <span className="text-gray-500 w-20 flex-shrink-0 pt-0.5">Cron</span>
                          <code className="text-cyan-400 bg-cyan-900/20 border border-cyan-900/30 px-2 py-1 rounded font-mono text-xs break-all">{s.expression}</code>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No schedulers found for this deployment.</p>
            )}
          </Sec>

          {/* HTTP Endpoints */}
          {(httpInbound.publicUrl || endpoints.length > 0) && (
            <Sec icon={Globe} title="HTTP Endpoints" count={endpoints.length}>
              {httpInbound.publicUrl && <PRow label="Public URL(s)" value={httpInbound.publicUrl} />}
              {httpInbound.internalUrl && <PRow label="Internal URL" value={httpInbound.internalUrl} />}
              <PRow label="Last Mile Security" value={httpInbound.lastMileSecurity != null ? String(httpInbound.lastMileSecurity) : undefined} />
              <PRow label="Forward SSL" value={httpInbound.forwardSslSession != null ? String(httpInbound.forwardSslSession) : undefined} />
              {endpoints.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">Endpoint List</p>
                  {endpoints.map((ep, i) => (
                    <div key={i} className="flex items-center gap-2 py-2 border-b border-gray-700/40 last:border-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${ep.access === 'external' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-600/30 text-gray-300'}`}>{ep.access}</span>
                      <span className="text-white text-xs font-mono break-all">{ep.url}</span>
                    </div>
                  ))}
                </div>
              )}
            </Sec>
          )}
        </div>
      )}

      {/* RAW JSON */}
      {activeTab === 'raw' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">Raw JSON</h3>
            <button onClick={copyJson} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors">
              <Copy size={12} /> {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="bg-gray-950 rounded-xl p-4 text-xs text-green-400 overflow-auto max-h-[600px] font-mono leading-relaxed">
            {JSON.stringify(app, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
