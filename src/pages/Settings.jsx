import React from 'react';
import { useRole } from '../Layout';
import { 
  User, 
  Shield, 
  Building2, 
  Scale, 
  ClipboardCheck,
  Wallet,
  CheckCircle2,
  Info
} from 'lucide-react';
import { cn } from "@/lib/utils";

const roles = [
  {
    id: 'GP',
    label: 'General Partner',
    icon: Building2,
    description: 'Asset manager and deal sponsor',
    permissions: ['Create deals', 'Update deal info', 'Submit for review', 'Manage distributions'],
    color: 'emerald'
  },
  {
    id: 'GP Analyst',
    label: 'GP Analyst',
    icon: User,
    description: 'Junior GP team member supporting deal execution',
    permissions: ['View assigned deals only', 'Edit deal data', 'Upload documents', 'Request GP review'],
    color: 'teal'
  },
  {
    id: 'Lender',
    label: 'Lender',
    icon: Wallet,
    description: 'Senior debt provider',
    permissions: ['Review underwriting', 'Approve transitions', 'Monitor covenants', 'Issue consent'],
    color: 'blue'
  },
  {
    id: 'Counsel',
    label: 'External Counsel',
    icon: Scale,
    description: 'External legal advisor',
    permissions: ['Review legal docs', 'Approve structure', 'Comment on terms', 'Task-based access'],
    color: 'indigo'
  },
  {
    id: 'Regulator',
    label: 'Regulator',
    icon: Shield,
    description: 'Regulatory compliance oversight',
    permissions: ['Read-only access', 'View all events', 'Generate snapshots', 'Certify records'],
    color: 'violet'
  },
  {
    id: 'Auditor',
    label: 'Auditor',
    icon: ClipboardCheck,
    description: 'Third-party audit verification',
    permissions: ['Read-only access', 'Verify event trail', 'Export audit reports', 'Check evidence'],
    color: 'amber'
  },
  {
    id: 'LP',
    label: 'Limited Partner',
    icon: User,
    description: 'Equity investor',
    permissions: ['View investment summary', 'Track distributions', 'Review reports', 'Consent to exits'],
    color: 'slate'
  }
];

export default function SettingsPage() {
  const { currentRole, setCurrentRole } = useRole();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">Settings</h1>
        <p className="text-sm text-[#737373] mt-1">
          Configure your viewing perspective for the demo
        </p>
      </div>

      {/* Role Switcher */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
        <div className="flex items-center gap-2 mb-6">
          <Shield className="w-5 h-5 text-[#171717]" />
          <h2 className="text-lg font-semibold text-[#171717]">Role Switcher</h2>
        </div>

        <p className="text-sm text-[#737373] mb-6">
          Switch between different stakeholder perspectives to see how the interface adapts. 
          The same deal data is presented differently based on role-specific needs and permissions.
        </p>

        <div className="space-y-3">
          {roles.map((role) => {
            const isActive = currentRole === role.id;
            const colorClasses = {
              emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
              teal: 'bg-teal-50 border-teal-200 text-teal-700',
              blue: 'bg-blue-50 border-blue-200 text-blue-700',
              indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
              violet: 'bg-violet-50 border-violet-200 text-violet-700',
              amber: 'bg-amber-50 border-amber-200 text-amber-700',
              slate: 'bg-slate-50 border-slate-200 text-slate-700'
            };

            return (
              <button
                key={role.id}
                onClick={() => setCurrentRole(role.id)}
                className={cn(
                  "w-full p-4 rounded-xl border-2 transition-all duration-200 text-left",
                  isActive 
                    ? "border-[#0A0A0A] bg-[#0A0A0A]" 
                    : "border-[#E5E5E5] hover:border-[#A3A3A3] bg-white"
                )}
              >
                <div className="flex items-start gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                    isActive ? "bg-white" : colorClasses[role.color]
                  )}>
                    <role.icon className={cn(
                      "w-5 h-5",
                      isActive ? "text-[#0A0A0A]" : ""
                    )} />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className={cn(
                        "font-semibold",
                        isActive ? "text-white" : "text-[#171717]"
                      )}>
                        {role.label}
                      </h3>
                      {isActive && (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      )}
                    </div>
                    <p className={cn(
                      "text-sm mt-0.5",
                      isActive ? "text-white/70" : "text-[#737373]"
                    )}>
                      {role.description}
                    </p>
                    
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {role.permissions.map((perm, i) => (
                        <span 
                          key={i}
                          className={cn(
                            "text-xs px-2 py-0.5 rounded",
                            isActive 
                              ? "bg-white/20 text-white/80" 
                              : "bg-[#F5F5F5] text-[#737373]"
                          )}
                        >
                          {perm}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Info Notice */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">Role-Adaptive Interface</p>
            <p className="text-xs text-blue-700 mt-1">
              The interface automatically adapts based on your selected role. Different stakeholders see:
            </p>
            <ul className="text-xs text-blue-700 mt-2 space-y-1">
              <li>• <strong>GP:</strong> Full deal management with action-oriented views</li>
              <li>• <strong>GP Analyst:</strong> Assigned deals only, data entry and document upload</li>
              <li>• <strong>Lender:</strong> Risk-focused dashboards with covenant monitoring</li>
              <li>• <strong>Counsel:</strong> Legal review with task-based document access</li>
              <li>• <strong>Regulator:</strong> Chronological, read-only compliance views</li>
              <li>• <strong>Auditor:</strong> Evidence-trail focused with export capabilities</li>
              <li>• <strong>LP:</strong> Investment summary with distribution tracking</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Demo Notice */}
      <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Demo Mode</p>
            <p className="text-xs text-amber-700 mt-1">
              This is a demonstration environment. In production, role assignment would be controlled 
              by authentication and authorization systems. Users would only see the interface 
              appropriate to their verified role.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}