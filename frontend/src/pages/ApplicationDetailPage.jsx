import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy, Clock, Database, Server, Settings } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import api from '../services/api';

const PropRow = ({ label, value, mono = true }) => (
  <div className="flex items-start py-2.5 border-b border-gray-800 last:border-0">
    <span className="text-gray-400 text-sm w-52 flex-shrink-0">{label}</span>
    <span className={`text-white text-sm break-all ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
  </div>
);

const Section = ({ icon: Icon, title, children }) => (
  <div className="bg-gray-800/40 rounded-xl p-4 space-y-0">
    <div className="flex items-center gap-2 mb-3">
      {Icon && <Icon size={15} className="text-blue-400" />}
      <h4 className="text-white font-semibold text-sm">{title}</h4>
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
      const res = await api.get(`/applications/cloudhub2/${orgId}/${envId}/${appId}`);
      setApp(res.data);
    } catch {
      try {
        const res2 = await api.get(`/applications/cloudhub1/${envId}/${appId}/properties`);
        setApp({ name: res2.data.appName, ...res2.data, _type: 'ch1' });
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
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div>;
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

  const ds = app.target?.deploymentSettings || {};
  const isOSEnabled = ds.hasPersistentObjectStore ?? ds.persistentObjectStore ?? false;
  const schedulers = ds.schedulerFrequencies || [];
  const resources = ds.resources || {};
  const isCH1 = app._type === 'ch1';

  const tabs = ['overview', 'properties', 'infrastructure', 'raw'];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/applications')} className="text-gray-400 hover:text-white">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">{app.name}</h1>
            <p className="text-gray-400 text-sm">{isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'} · {app.id || appId}</p>
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

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div>
            <h3 className="text-white font-semibold mb-3">General Information</h3>
            <PropRow label="Application ID" value={app.id || appId} />
            <PropRow label="Name" value={app.name} mono={false} />
            <PropRow label="Runtime Status" value={app.application?.status || app.status} />
            <PropRow label="Desired State" value={app.application?.desiredState || app.desiredStatus} />
            <PropRow label="Mule Version" value={ds.runtimeVersion || app.muleVersion} />
            <PropRow label="Deployment Type" value={isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'} />
            <PropRow label="Region" value={app.target?.region || app.region} />
            <PropRow label="Artifact" value={app.application?.ref ? `${app.application.ref.artifactId} v${app.application.ref.version}` : undefined} />
            <PropRow label="Replicas" value={ds.updateStrategy?.replicas ?? ds.replicas} />
            <PropRow label="Workers" value={app.workers?.amount} />
            <PropRow label="Worker Type" value={app.workers?.type?.name} />
            <PropRow label="Last Modified" value={app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleString() : undefined} />
          </div>
        )}

        {/* PROPERTIES */}
        {activeTab === 'properties' && (
          <div className="space-y-6">
            {/* CH2: target.deploymentSettings.properties */}
            {Object.keys(ds.properties || {}).length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-3">Deployment Properties</h3>
                {Object.entries(ds.properties).map(([k, v]) => (
                  <PropRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                ))}
              </div>
            )}
            {/* CH1: app.properties */}
            {Object.keys(app.properties || {}).length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-3">Application Properties</h3>
                {Object.entries(app.properties).map(([k, v]) => (
                  <PropRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                ))}
              </div>
            )}
            {/* CH2: environmentVars */}
            {Object.keys(ds.environmentVars || {}).length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-3">Environment Variables</h3>
                {Object.entries(ds.environmentVars).map(([k, v]) => (
                  <PropRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                ))}
              </div>
            )}
            {/* Extra settings from /settings endpoint */}
            {app._settings && Object.keys(app._settings).length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-3">App Settings</h3>
                {Object.entries(app._settings).map(([k, v]) => (
                  <PropRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                ))}
              </div>
            )}
            {/* Agent props */}
            {Object.keys(app.application?.configuration?.muleAgentApplicationPropertiesService?.properties || {}).length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-3">Agent Properties</h3>
                {Object.entries(app.application.configuration.muleAgentApplicationPropertiesService.properties).map(([k, v]) => (
                  <PropRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                ))}
              </div>
            )}
            {!Object.keys(ds.properties || {}).length &&
              !Object.keys(app.properties || {}).length &&
              !Object.keys(ds.environmentVars || {}).length && (
              <div className="space-y-3">
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3 text-sm text-yellow-400">
                  No deployment-level properties found. This can happen when:
                  <ul className="list-disc list-inside mt-1.5 space-y-1 text-yellow-400/80">
                    <li>Properties are defined inside the app's <code className="font-mono text-xs">config.yaml</code> / properties file (not accessible via API)</li>
                    <li>Properties are secured/encrypted (Anypoint Platform does not return secure property values via API)</li>
                    <li>No properties were configured at deployment time</li>
                  </ul>
                  <p className="mt-2">Check the <strong>Raw</strong> tab to see the full deployment response.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* INFRASTRUCTURE */}
        {activeTab === 'infrastructure' && (
          <div className="space-y-5">

            {/* Resources */}
            <Section icon={Server} title="Resources">
              {!isCH1 ? (
                <>
                  <PropRow label="CPU Reserved" value={resources.cpu?.reserved} />
                  <PropRow label="CPU Limit" value={resources.cpu?.limit} />
                  <PropRow label="Memory" value={resources.memory?.reserved} />
                  <PropRow label="Replicas" value={ds.updateStrategy?.replicas ?? ds.replicas} />
                  <PropRow label="Update Strategy" value={ds.updateStrategy?.strategy} />
                  <PropRow label="Clustered" value={ds.clustered != null ? String(ds.clustered) : undefined} />
                </>
              ) : (
                <>
                  <PropRow label="Workers" value={app.workers?.amount} />
                  <PropRow label="Worker Type" value={app.workers?.type?.name} />
                  <PropRow label="Worker Memory" value={app.workers?.type?.memory} />
                  <PropRow label="Worker vCores" value={app.workers?.type?.cpu} />
                </>
              )}
            </Section>

            {/* Object Store */}
            <Section icon={Database} title="Object Store">
              <PropRow label="Persistent Object Store"
                value={isOSEnabled ? '✅ Enabled' : '❌ Disabled'} mono={false} />
              {!isCH1 && (
                <>
                  <PropRow label="Persistent Queues" value={app.persistentQueues != null ? String(app.persistentQueues) : undefined} />
                </>
              )}
              {isCH1 && (
                <PropRow label="Persistent Queues" value={app.persistentQueues != null ? String(app.persistentQueues) : undefined} />
              )}
            </Section>

            {/* Schedulers */}
            <Section icon={Clock} title={`Schedulers${schedulers.length > 0 ? ` (${schedulers.length})` : ''}`}>
              {schedulers.length > 0 ? (
                <div className="space-y-3">
                  {schedulers.map((s, i) => (
                    <div key={i} className="bg-gray-900 rounded-lg px-4 py-3 border border-gray-700">
                      <p className="text-white text-sm font-medium mb-2">{s.name || s.schedulerName || `Scheduler ${i + 1}`}</p>
                      <div className="space-y-1.5 text-xs">
                        {s.frequency?.expression && (
                          <div className="flex gap-2">
                            <span className="text-gray-400 w-24">Expression</span>
                            <span className="text-cyan-400 font-mono">{s.frequency.expression}</span>
                          </div>
                        )}
                        {s.frequency?.timeUnit && (
                          <div className="flex gap-2">
                            <span className="text-gray-400 w-24">Time Unit</span>
                            <span className="text-white font-mono">{s.frequency.timeUnit}</span>
                          </div>
                        )}
                        {s.frequency?.value && (
                          <div className="flex gap-2">
                            <span className="text-gray-400 w-24">Frequency</span>
                            <span className="text-white font-mono">{s.frequency.value} {s.frequency.timeUnit}</span>
                          </div>
                        )}
                        {s.frequency?.timezone && (
                          <div className="flex gap-2">
                            <span className="text-gray-400 w-24">Timezone</span>
                            <span className="text-white font-mono">{s.frequency.timezone}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">No scheduler overrides configured for this deployment.</p>
              )}
            </Section>

            {/* HTTP / Network */}
            {ds.http && (
              <Section icon={Settings} title="HTTP / Network">
                <PropRow label="Inbound URL" value={ds.http.inboundPublicUrl} />
                <PropRow label="Last Mile Security" value={ds.http.lastMileSecurity != null ? String(ds.http.lastMileSecurity) : undefined} />
                <PropRow label="Forward SSL" value={ds.http.forwardSslSession != null ? String(ds.http.forwardSslSession) : undefined} />
                <PropRow label="Static IPs" value={app.staticIPsEnabled != null ? String(app.staticIPsEnabled) : undefined} />
              </Section>
            )}

            {/* CH1 additional */}
            {isCH1 && (
              <Section icon={Settings} title="CloudHub 1.0 Settings">
                <PropRow label="Monitoring" value={app.monitoringEnabled != null ? String(app.monitoringEnabled) : undefined} />
                <PropRow label="Custom Log4j" value={app.loggingCustomLog4JEnabled != null ? String(app.loggingCustomLog4JEnabled) : undefined} />
                <PropRow label="Static IPs" value={app.staticIPsEnabled != null ? String(app.staticIPsEnabled) : undefined} />
              </Section>
            )}
          </div>
        )}

        {/* RAW JSON */}
        {activeTab === 'raw' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold">Raw JSON</h3>
              <button onClick={copyJson} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg">
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="bg-gray-950 rounded-lg p-4 text-xs text-green-400 overflow-auto max-h-[500px] font-mono">
              {JSON.stringify(app, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}