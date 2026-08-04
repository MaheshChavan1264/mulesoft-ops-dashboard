import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { RefreshCw, Layers, ChevronRight } from 'lucide-react';
import api from '../services/api';

export default function BusinessGroupsPage() {
  const { orgId } = useAuth();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);

  useEffect(() => {
    if (orgId) load();
  }, [orgId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      setGroups(res.data.data || []);
    } catch {
      setGroups([]);
    }
    setLoading(false);
  };

  const selectGroup = async (group) => {
    setSelected(group);
    setMembersLoading(true);
    try {
      const res = await api.get(`/organizations/${group.id}/members`);
      setMembers(res.data.data || []);
    } catch {
      setMembers([]);
    }
    setMembersLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Business Groups</h1>
          <p className="text-gray-400 text-sm mt-1">{groups.length} groups in your organization hierarchy</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Group List */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800">
            <h3 className="text-white font-semibold">Groups</h3>
          </div>
          <div className="divide-y divide-gray-800">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => selectGroup(g)}
                className={`w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-800/50 text-left transition-colors ${
                  selected?.id === g.id ? 'bg-blue-600/10 border-l-2 border-blue-500' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <Layers size={16} className="text-blue-400 flex-shrink-0" />
                  <div>
                    <p className="text-white text-sm font-medium">{g.name}</p>
                    <p className="text-gray-500 text-xs">{g.domain}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {g.parentId && (
                    <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">Sub-group</span>
                  )}
                  <ChevronRight size={14} className="text-gray-600" />
                </div>
              </button>
            ))}
            {groups.length === 0 && (
              <p className="px-5 py-8 text-center text-gray-500 text-sm">No business groups found.</p>
            )}
          </div>
        </div>

        {/* Group Detail */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {selected ? (
            <>
              <div className="px-5 py-3 border-b border-gray-800">
                <h3 className="text-white font-semibold">{selected.name}</h3>
                <p className="text-gray-400 text-xs mt-0.5">{selected.id}</p>
              </div>
              <div className="p-5 space-y-3 text-sm border-b border-gray-800">
                <div className="flex justify-between">
                  <span className="text-gray-400">Domain</span>
                  <span className="text-white">{selected.domain || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Type</span>
                  <span className="text-white capitalize">{selected.type || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Parent ID</span>
                  <span className="text-gray-400 font-mono text-xs">{selected.parentId || 'Root'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Sub-Groups</span>
                  <span className="text-white">{selected.subOrganizationIds?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Created</span>
                  <span className="text-white text-xs">{selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : '—'}</span>
                </div>
              </div>
              <div className="px-5 py-3 border-b border-gray-800">
                <h4 className="text-gray-300 font-medium text-sm">Members</h4>
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-gray-800">
                {membersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                  </div>
                ) : members.length > 0 ? (
                  members.map((m) => (
                    <div key={m.id} className="px-5 py-2.5 flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-blue-600/30 flex items-center justify-center text-blue-400 text-xs font-bold flex-shrink-0">
                        {(m.firstName?.[0] || m.username?.[0] || 'U').toUpperCase()}
                      </div>
                      <div>
                        <p className="text-white text-sm">{m.firstName} {m.lastName}</p>
                        <p className="text-gray-500 text-xs">{m.username}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="px-5 py-6 text-center text-gray-500 text-sm">No members found.</p>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full py-20 text-gray-500 text-sm">
              Select a business group to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}