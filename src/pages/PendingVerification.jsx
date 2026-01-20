import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useAuth } from '@/lib/AuthContext';
import { Clock, CheckCircle2, LogOut, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function PendingVerification() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [user, setUser] = useState(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('auth_user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  async function checkStatus() {
    setIsChecking(true);
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        navigate(createPageUrl('Login'));
        return;
      }

      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        navigate(createPageUrl('Login'));
        return;
      }

      const data = await response.json();

      if (data.user.status === 'ACTIVE') {
        localStorage.setItem('auth_user', JSON.stringify(data.user));
        navigate(createPageUrl('Home'));
      } else if (data.user.status === 'SUSPENDED') {
        navigate(createPageUrl('Login'));
      }
    } catch (err) {
      console.error('Failed to check status:', err);
    } finally {
      setIsChecking(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    logout();
    navigate(createPageUrl('Login'));
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-amber-50 to-orange-50 p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 mb-4 shadow-lg">
            <Clock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Account Pending</h1>
          <p className="text-slate-600 mt-1">Waiting for administrator approval</p>
        </div>

        <Card className="shadow-xl border-0">
          <CardHeader className="space-y-1 pb-4 text-center">
            <div className="mx-auto w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <Clock className="w-10 h-10 text-amber-600" />
            </div>
            <CardTitle className="text-xl">Verification Required</CardTitle>
            <CardDescription>
              Your account is awaiting verification by your organization's administrator
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* User Info */}
            {user && (
              <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Name</span>
                  <span className="font-medium text-slate-900">{user.name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Email</span>
                  <span className="font-medium text-slate-900">{user.email}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Role</span>
                  <span className="font-medium text-slate-900">{user.role}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Organization</span>
                  <span className="font-medium text-slate-900">{user.organization?.name}</span>
                </div>
              </div>
            )}

            {/* What happens next */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">What happens next?</h3>
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-amber-600">1</span>
                  </div>
                  <p className="text-sm text-slate-600">
                    An administrator at your organization will review your account request
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-amber-600">2</span>
                  </div>
                  <p className="text-sm text-slate-600">
                    Once approved, you'll have full access to deals and features
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                  </div>
                  <p className="text-sm text-slate-600">
                    You'll receive an email notification when approved
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3 pt-2">
              <Button
                onClick={checkStatus}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
                disabled={isChecking}
              >
                {isChecking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking status...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Check verification status
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={handleLogout}
                className="w-full"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <p className="text-sm text-slate-500">
            Need help?{' '}
            <a href="mailto:support@canonical.com" className="text-amber-600 hover:underline">
              Contact support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
