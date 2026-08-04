import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy, Clock, Database, Server, Settings, Globe } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import api from '../services/api';

const PropRow = ({ label, value, mono = true }) => (
  <div className="flex items-start py-2.5 border-b border-gray-800 last:border-0">
    <span className="text-gray-400 text-sm w-56 flex-shrink-0">{label}</span>
    <span className={`text-white text-sm break-all ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
  </div>
);

const Section = ({ icon: Icon, title, count, children }) => (
  <div className="bg-gray-800/40 rounded-xl p-4">
    <div className="flex items-center gap-2 mb-3">
      {Icon && <Icon size={15} className="text-blue-400" />}
      <h4 className="text-white font-semibold text-sm">{title}</h4>
      {count != null && (
        <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">{count}</span>
      )}
    </div>
    {children}
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
      // Try CH2 first
      const res = await api.get(`/applications/cloudhub2/${orgId}/${envId}/${appId}`);
      setApp(res.data);
    } catch {
      try {
        // Fetch full CH1 app (not just /properties subset)
        const res2 = await api.get(`/applications/cloudhub1/${envId}/${appId}`, {
          params: { orgId }
        });
        const ch1 = res2.data;
        // Normalize CH1 response to a consistent shape for the detail page
        setApp({
          _type: 'ch1',
          id: ch1.domain,
          name: ch1.domain,
          status: ch1.status,
          region: ch1.region,
          muleVersion: ch1.muleVersion?.version,
          lastModifiedDate: ch1.lastUpdateTime ? new Date(ch1.lastUpdateTime).toISOString() : null,
          properties: ch1.properties || {},
          persistentQueues: ch1.persistentQueues,
          staticIPsEnabled: ch1.staticIPsEnabled,
          loggingCustomLog4JEnabled: ch1.loggingCustomLog4JEnabled,
          monitoringEnabled: ch1.monitoringEnabled,
          // Workers: flatten for display
          workers: {
            amount: ch1.workers?.amount,
            type: ch1.workers?.type
          },
          _raw: ch1
        });
      } catch { setApp(null); }
    }
    setLoading(false);
  };

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(app, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/applications')} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-8 text-center text-red-400">
          Application not found or access denied.
        </div>
      </div>
    );
  }

  // ── Parse payload paths ──────────────────────────────────────────────────
  const ds = app.target?.deploymentSettings || {};
  const appCfg = app.application?.configuration || {};
  const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
  const schedSvc = appCfg['mule.agent.scheduling.service'] || {};
  const runtimeProps = propsSvc.properties || {};
  const secureProps = propsSvc.secureProperties || {};
  const schedulers = schedSvc.schedulers || [];
  const httpInbound = ds.http?.inbound || {};
  const endpoints = httpInbound.endpoints || [];
  const envVars = ds.environmentVariables || ds.environmentVars || {};
  const isCH1 = app._type === 'ch1';
  const replicas = app.target?.replicas ?? ds.replicas;
  const osEnabled = ds.persistentObjectStore ?? ds.hasPersistentObjectStore ?? false;
  const replicaList = app.replicas || [];

  const hasProperties =
    Object.keys(runtimeProps).length > 0 ||
    Object.keys(ds.properties || {}).length > 0 ||
    Object.keys(envVars).length > 0 ||
    Object.keys(app.properties || {}).length > 0;

  const tabs = ['overview', 'properties', 'infrastructure', 'raw'];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/applications')} className="text-gray-400 hover:text-white">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">{app.name}</h1>
            <p className="text-gray-400 text-sm">
              {isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'}
              {app.application?.ref && ` · ${app.application.ref.artifactId} v${app.application.ref.version}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={app.application?.status || app.status} />
          <button onClick={load} className="text-gray-400 hover:text-white bg-gray-800 p-2 rounded-lg">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit">
        {tabs.map((t) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
              activeTab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}>
            {t === 'infrastructure' ? 'Infra & Config' : t}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">

        {/* ── OVERVIEW ──────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div>
            <h3 className="text-white font-semibold mb-3">General Information</h3>
            <PropRow label="Application ID" value={app.id} />
            <PropRow label="Name" value={app.name} mono={false} />
            {isCH1 ? (
              <>
                <PropRow label="Status" value={app.status} />
                <PropRow label="Mule Version" value={app.muleVersion} />
                <PropRow label="Region" value={app.region} />
                <PropRow label="Workers" value={app.workers?.amount != null ? String(app.workers.amount) : undefined} />
                <PropRow label="Worker Type" value={app.workers?.type?.name || app.workers?.type} />
                <PropRow label="Last Modified" value={app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleString() : undefined} />
              </>
            ) : (
              <>
                <PropRow label="Runtime Status" value={app.application?.status} />
                <PropRow label="Desired State" value={app.application?.desiredState} />
                <PropRow label="Deployment Status" value={app.status} />
                <PropRow label="Mule Version" value={ds.runtime?.version || ds.runtimeVersion} />
                <PropRow label="Java" value={ds.runtime?.java ? `Java ${ds.runtime.java}` : undefined} />
                <PropRow label="Release Channel" value={ds.runtime?.releaseChannel || ds.runtimeReleaseChannel} />
                <PropRow label="vCores" value={app.application?.vCores != null ? String(app.application.vCores) : undefined} />
                <PropRow label="Replicas" value={replicas != null ? String(replicas) : undefined} />
                <PropRow label="Update Strategy" value={typeof ds.updateStrategy === 'string' ? ds.updateStrategy : undefined} />
                <PropRow label="Artifact" value={app.application?.ref ? `${app.application.ref.artifactId} v${app.application.ref.version}` : undefined} />
                <PropRow label="Last Modified" value={app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleString() : undefined} />
              </>
            )}

            {replicaList.length > 0 && (
              <div className="mt-4">
                <p className="text-gray-400 text-xs uppercase tracking-wider mb-2 font-medium">
                  Replica Instances ({replicaList.length})
                </p>
                <div className="space-y-2">
                  {replicaList.map((r) => (
                    <div key={r.id} className="bg-gray-800/50 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-gray-300 text-xs font-mono truncate">{r.id}</span>
                      <StatusBadge status={r.state} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PROPERTIES ────────────────────────────────── */}
        {activeTab === 'properties' && (
          <div className="space-y-6">
            {Object.keys(runtimeProps).length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-1">Runtime Properties</h3>
                <p className="text-gray-500 text-xs mb-3 font-mono">
                  application.configuration["mule.agent.application.properties.service"].properties
                </p>
                {Object.entries(runtimeProps).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
                  <PropRow key={k} label={k} value={String(v)} />
                ))}
                {Object.keys(secureProps).length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">
                      Secure Properties (values redacted by Anypoint)
                    </p>
                    {Object.entries(secureProps).map(([k, v]) => (
                      <PropRow key={k} label={k} value={String(v)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {Object.keys(ds.properties || {}).length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-3">Deployment Properties</h3>
                {Object.entries(ds.properties).map(([k, v]) => (
                  <PropRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                ))}
              </div>
            )}

            {Object.keys(envVars).length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-3">Environment Variables</h3>
                {Object.entries(envVars).map(([k, v]) => (
                  <PropRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                ))}
              </div>
            )}

            {Object.keys(app.properties || {}).length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-3">Application Properties (CH1)</h3>
                {Object.entries(app.properties).map(([k, v]) => (
                  <PropRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                ))}
              </div>
            )}

            {!hasProperties && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3 text-sm text-yellow-400">
                No properties found. Anypoint API does not expose file-based or secure properties.
                Check the <strong>Raw</strong> tab to inspect the full response.
              </div>
            )}
          </div>
        )}

        {/* ── INFRASTRUCTURE ────────────────────────────── */}
        {activeTab === 'infrastructure' && (
          <div className="space-y-5">
            <Section icon={Server} title="Resources">
              {!isCH1 ? (
                <>
                  <PropRow label="vCores" value={app.application?.vCores != null ? String(app.application.vCores) : undefined} />
                  <PropRow label="Replicas" value={replicas != null ? String(replicas) : undefined} />
                  <PropRow label="Update Strategy" value={typeof ds.updateStrategy === 'string' ? ds.updateStrategy : undefined} />
                  <PropRow label="Clustered" value={ds.clustered != null ? String(ds.clustered) : undefined} />
                  <PropRow label="Spread Replicas" value={ds.enforceDeployingReplicasAcrossNodes != null ? String(ds.enforceDeployingReplicasAcrossNodes) : undefined} />
                  <PropRow label="JVM Args" value={ds.jvm?.args || '(none)'} />
                  <PropRow label="Tracing" value={ds.tracingEnabled != null ? String(ds.tracingEnabled) : undefined} />
                  <PropRow label="AM Log Forwarding" value={ds.disableAmLogForwarding != null ? String(!ds.disableAmLogForwarding) : undefined} />
                </>
              ) : (
                <>
                  <PropRow label="Workers" value={app.workers?.amount} />
                  <PropRow label="Worker Type" value={app.workers?.type?.name} />
                  <PropRow label="Worker Memory" value={app.workers?.type?.memory} />
                </>
              )}
            </Section>

            <Section icon={Database} title="Object Store">
              <PropRow label="Persistent Object Store" value={osEnabled ? '✅ Enabled' : '❌ Disabled'} mono={false} />
              {isCH1 && <PropRow label="Persistent Queues" value={app.persistentQueues != null ? String(app.persistentQueues) : undefined} />}
            </Section>

            <Section icon={Clock} title="Schedulers" count={schedulers.length}>
              {schedulers.length > 0 ? (
                <div className="space-y-2">
                  {schedulers.map((s, i) => (
                    <div key={i} className="bg-gray-900 rounded-lg px-4 py-3 border border-gray-700">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white text-sm font-medium font-mono">{s.flowName || s.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          s.enabled !== false ? 'bg-green-500/20 text-green-400' : 'bg-gray-600/30 text-gray-400'
                        }`}>{s.enabled !== false ? 'Enabled' : 'Disabled'}</span>
                      </div>
                      <div className="text-xs space-y-1 text-gray-400">
                        {s.name && s.name !== s.flowName && <div>Name: <span className="text-gray-300 font-mono">{s.name}</span></div>}
                        {s.type && <div>Type: <span className="text-gray-300">{s.type}</span></div>}
                        {s.expression && <div>Expression: <span className="text-cyan-400 font-mono">{s.expression}</span></div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">No schedulers found for this deployment.</p>
              )}
            </Section>

            {(httpInbound.publicUrl || endpoints.length > 0) && (
              <Section icon={Globe} title="HTTP Endpoints">
                {httpInbound.publicUrl && (
                  <PropRow label="Public URL(s)" value={httpInbound.publicUrl} />
                )}
                {httpInbound.internalUrl && (
                  <PropRow label="Internal URL" value={httpInbound.internalUrl} />
                )}
                <PropRow label="Last Mile Security" value={httpInbound.lastMileSecurity != null ? String(httpInbound.lastMileSecurity) : undefined} />
                <PropRow label="Forward SSL" value={httpInbound.forwardSslSession != null ? String(httpInbound.forwardSslSession) : undefined} />
                {endpoints.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">Endpoints</p>
                    {endpoints.map((ep, i) => (
                      <div key={i} className="py-2 border-b border-gray-700 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            ep.access === 'external' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-600/30 text-gray-300'
                          }`}>{ep.access}</span>
                          <span className="text-white text-xs font-mono break-all">{ep.url}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {isCH1 && (
              <Section icon={Settings} title="CloudHub 1.0 Settings">
                <PropRow label="Monitoring" value={app.monitoringEnabled != null ? String(app.monitoringEnabled) : undefined} />
                <PropRow label="Custom Log4j" value={app.loggingCustomLog4JEnabled != null ? String(app.loggingCustomLog4JEnabled) : undefined} />
                <PropRow label="Static IPs" value={app.staticIPsEnabled != null ? String(app.staticIPsEnabled) : undefined} />
              </Section>
            )}
          </div>
        )}

        {/* ── RAW JSON ──────────────────────────────────── */}
        {activeTab === 'raw' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold">Raw JSON</h3>
              <button onClick={copyJson} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg">
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="bg-gray-950 rounded-lg p-4 text-xs text-green-400 overflow-auto max-h-[600px] font-mono">
              {JSON.stringify(app, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}