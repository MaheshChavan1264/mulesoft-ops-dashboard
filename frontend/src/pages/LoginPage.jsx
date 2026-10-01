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
  const { login, tokenLogin, connectedAppLogin, demoLogin } = useAuth();
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
    <div className="min-h-screen bg-[#f3f2f2] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sf-600 mb-4 shadow-sm">
            <span className="text-white font-bold text-2xl">M</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">MuleSoft Dashboard</h1>
          <p className="text-gray-500 mt-1">Connect to Anypoint Platform</p>
        </div>

        {/* Demo button */}
        <button
          onClick={handleDemoLogin}
          className="w-full mb-4 flex items-center justify-center gap-2 bg-gradient-to-r from-sfpurple-600 to-sf-600 hover:from-sfpurple-500 hover:to-sf-500 text-white font-semibold py-3 rounded-xl transition-all shadow-md shadow-sf-200"
        >
          <Zap size={18} />
          Try Demo Mode — No login required
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gray-300"></div>
          <span className="text-gray-400 text-xs">or sign in with your account</span>
          <div className="flex-1 h-px bg-gray-300"></div>
        </div>

        {/* Card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          {/* Tabs */}
          <div className="flex rounded-lg bg-gray-100 p-1 mb-5 gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTab(t.id); setError(''); }}
                className={`flex-1 py-2 px-2 rounded-md text-xs font-medium transition-colors ${
                  tab === t.id ? 'bg-white text-sf-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Connected App tab */}
          {tab === 'app' && (
            <div className="mb-4 bg-sf-50 border border-sf-200 rounded-lg p-4 text-sm">
              <div className="flex items-start gap-2">
                <Link2 size={15} className="text-sf-600 mt-0.5 flex-shrink-0" />
                <div className="text-gray-700">
                  <p className="font-medium text-sf-700 mb-1">Recommended for SSO users</p>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Create a <strong className="text-gray-900">Connected App</strong> in Anypoint Platform with Client Credentials grant. 
                    This works independently of SSO.
                  </p>
                  <p className="text-xs text-sf-700 mt-2 font-medium">
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
                className="flex items-center gap-1.5 text-xs text-sf-600 hover:text-sf-700 mb-3"
              >
                <Info size={13} />
                How to get your bearer token from browser DevTools (SSO users)
              </button>
              {showTokenGuide && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-700 space-y-1.5 mb-3 leading-relaxed">
                  <p className="text-gray-500 font-medium mb-2">Steps to grab your token:</p>
                  <p>1. Log in to <span className="text-sf-600 font-medium">anypoint.mulesoft.com</span> via SSO as usual</p>
                  <p>2. Open browser DevTools → <span className="text-sforange-600 font-medium">Network</span> tab</p>
                  <p>3. Filter by <span className="text-sfgreen-600 font-medium">XHR</span> and reload the page</p>
                  <p>4. Click any API request (e.g. to <span className="font-mono text-gray-900">/accounts/api/me</span>)</p>
                  <p>5. In Request Headers find <span className="font-mono text-sforange-600">{'Authorization: Bearer <token>'}</span></p>
                  <p>6. Copy everything after <span className="font-mono">Bearer </span> and paste below</p>
                  <p className="text-gray-400 pt-1">⚠ Tokens expire — typically valid for a few hours.</p>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'app' && (
              <>
                <div>
                  <label className="block text-sm text-gray-600 mb-1.5">Client ID</label>
                  <div className="relative">
                    <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      required
                      className="w-full bg-white border border-gray-300 rounded-lg pl-9 pr-4 py-2.5 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-sf-500 focus:ring-1 focus:ring-sf-500 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1.5">Client Secret</label>
                  <div className="relative">
                    <Key size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="••••••••••••••••••••••••••••••••"
                      required
                      className="w-full bg-white border border-gray-300 rounded-lg pl-9 pr-10 py-2.5 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-sf-500 focus:ring-1 focus:ring-sf-500 font-mono"
                    />
                    <button type="button" onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {tab === 'credentials' && (
              <>
                <div>
                  <label className="block text-sm text-gray-600 mb-1.5">Username</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                      placeholder="your@email.com" required
                      className="w-full bg-white border border-gray-300 rounded-lg pl-9 pr-4 py-2.5 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-sf-500 focus:ring-1 focus:ring-sf-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1.5">Password</label>
                  <div className="relative">
                    <Key size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type={showPassword ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required
                      className="w-full bg-white border border-gray-300 rounded-lg pl-9 pr-10 py-2.5 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-sf-500 focus:ring-1 focus:ring-sf-500" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {tab === 'token' && (
              <div>
                <label className="block text-sm text-gray-600 mb-1.5">Bearer Token</label>
                <textarea value={token} onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your bearer token here..." required rows={4}
                  className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-sf-500 focus:ring-1 focus:ring-sf-500 resize-none font-mono" />
              </div>
            )}

            {error && (
              <div className="bg-sfred-50 border border-sfred-200 rounded-lg px-4 py-3 text-sfred-700 text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-sf-600 hover:bg-sf-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm">
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

        <p className="text-center text-xs text-gray-400 mt-6">
          MuleSoft Integration Dashboard · Credentials are never stored
        </p>
      </div>
    </div>
  );
}
