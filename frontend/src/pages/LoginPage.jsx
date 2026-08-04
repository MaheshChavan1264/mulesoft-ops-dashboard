import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, Key, User, Zap, Link2, Info } from 'lucide-react';
import api from '../services/api';

const TABS = [
  { id: 'app', label: 'Connected App' },
  { id: 'credentials', label: 'Username & Password' },
  { id: 'token', label: 'Bearer Token' }
];

export default function LoginPage() {
  const { login, demoLogin, setSessionFromResult } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('app');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showTokenGuide, setShowTokenGuide] = useState(false);

  const { tokenLogin, connectedAppLogin } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'credentials') {
        await login(username, password);
      } else if (tab === 'token') {
        await tokenLogin(token);
      } else if (tab === 'app') {
        await connectedAppLogin(clientId, clientSecret);
      }
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = () => {
    demoLogin();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <span className="text-white font-bold text-2xl">M</span>
          </div>
          <h1 className="text-2xl font-bold text-white">MuleSoft Dashboard</h1>
          <p className="text-gray-400 mt-1">Connect to Anypoint Platform</p>
        </div>

        {/* Demo button */}
        <button
          onClick={handleDemoLogin}
          className="w-full mb-4 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-blue-900/30"
        >
          <Zap size={18} />
          Try Demo Mode — No login required
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gray-800"></div>
          <span className="text-gray-500 text-xs">or sign in with your account</span>
          <div className="flex-1 h-px bg-gray-800"></div>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          {/* Tabs */}
          <div className="flex rounded-lg bg-gray-800 p-1 mb-5 gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTab(t.id); setError(''); }}
                className={`flex-1 py-2 px-2 rounded-md text-xs font-medium transition-colors ${
                  tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Connected App tab */}
          {tab === 'app' && (
            <div className="mb-4 bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 text-sm">
              <div className="flex items-start gap-2">
                <Link2 size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="text-gray-300">
                  <p className="font-medium text-blue-300 mb-1">Recommended for SSO users</p>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Create a <strong className="text-gray-200">Connected App</strong> in Anypoint Platform with Client Credentials grant. 
                    This works independently of SSO.
                  </p>
                  <p className="text-xs text-blue-400 mt-2 font-medium">
                    Anypoint Platform → Access Management → Connected Apps → Create App
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Required scopes: Runtime Manager, API Manager, Exchange Viewer, General Profile
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Bearer Token tab — guide */}
          {tab === 'token' && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setShowTokenGuide(!showTokenGuide)}
                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 mb-3"
              >
                <Info size={13} />
                How to get your bearer token from browser DevTools (SSO users)
              </button>
              {showTokenGuide && (
                <div className="bg-gray-800 rounded-lg p-4 text-xs text-gray-300 space-y-1.5 mb-3 leading-relaxed">
                  <p className="text-gray-400 font-medium mb-2">Steps to grab your token:</p>
                  <p>1. Log in to <span className="text-blue-400">anypoint.mulesoft.com</span> via SSO as usual</p>
                  <p>2. Open browser DevTools → <span className="text-yellow-400">Network</span> tab</p>
                  <p>3. Filter by <span className="text-green-400">XHR</span> and reload the page</p>
                  <p>4. Click any API request (e.g. to <span className="font-mono text-gray-200">/accounts/api/me</span>)</p>
                  <p>5. In Request Headers find <span className="font-mono text-yellow-400">{'Authorization: Bearer <token>'}</span></p>
                  <p>6. Copy everything after <span className="font-mono">Bearer </span> and paste below</p>
                  <p className="text-gray-500 pt-1">⚠ Tokens expire — typically valid for a few hours.</p>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'app' && (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Client ID</label>
                  <div className="relative">
                    <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      required
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Client Secret</label>
                  <div className="relative">
                    <Key size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="••••••••••••••••••••••••••••••••"
                      required
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-10 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <button type="button" onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {tab === 'credentials' && (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Username</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                      placeholder="your@email.com" required
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Password</label>
                  <div className="relative">
                    <Key size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input type={showPassword ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-10 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {tab === 'token' && (
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Bearer Token</label>
                <textarea value={token} onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your bearer token here..." required rows={4}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none font-mono" />
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
              {loading ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>Connecting...</>
              ) : (
                tab === 'app' ? 'Connect with Connected App' :
                tab === 'credentials' ? 'Sign In' :
                'Connect with Token'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          MuleSoft Integration Dashboard · Credentials are never stored
        </p>
      </div>
    </div>
  );
}