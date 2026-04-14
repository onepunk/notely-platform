/**
 * Unified Navigation Configuration
 * All nav visibility is driven by permissions (DB-backed via RBAC page)
 * super_admin sees everything (hasPermission returns true for super_admin)
 */

import DashboardIcon from '@mui/icons-material/Dashboard';
import EventNoteIcon from '@mui/icons-material/EventNote';
import DescriptionIcon from '@mui/icons-material/Description';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import SettingsIcon from '@mui/icons-material/Settings';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import DnsIcon from '@mui/icons-material/Dns';
import SpeedIcon from '@mui/icons-material/Speed';
import TuneIcon from '@mui/icons-material/Tune';
import SecurityIcon from '@mui/icons-material/Security';
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import GroupsIcon from '@mui/icons-material/Groups';
import ChecklistIcon from '@mui/icons-material/Checklist';
import ExtensionIcon from '@mui/icons-material/Extension';
import EventIcon from '@mui/icons-material/Event';
import { NavItem } from '@/types/navigation';

const navItems: NavItem[] = [
  // ── User-facing pages ──
  {
    id: 'overview',
    title: 'Dashboard',
    href: '/',
    icon: DashboardIcon,
    permissions: ['dashboard:read'],
  },
  {
    id: 'calendar',
    title: 'Calendar',
    href: '/calendar',
    icon: EventNoteIcon,
    permissions: ['calendar:read'],
    requiresLicense: true,
  },
  {
    id: 'transcripts',
    title: 'Transcripts',
    href: '/transcripts',
    icon: DescriptionIcon,
    permissions: ['transcripts:read'],
    requiresLicense: true,
  },
  {
    id: 'recordings',
    title: 'Recordings',
    href: '/recordings',
    icon: GraphicEqIcon,
    permissions: ['recordings:read'],
    requiresLicense: true,
  },
  {
    id: 'insights',
    title: 'Insights',
    href: '/insights',
    icon: LightbulbIcon,
    permissions: ['insights:read'],
    requiresLicense: true,
  },
  {
    id: 'actions',
    title: 'Actions',
    href: '/actions',
    icon: ChecklistIcon,
    permissions: ['actions:read'],
    requiresLicense: true,
  },
  {
    id: 'meetings',
    title: 'Meetings',
    href: '/meetings',
    icon: EventIcon,
    permissions: ['meetings:read'],
    requiresLicense: true,
  },
  {
    id: 'integrations',
    title: 'Integrations',
    href: '/integrations',
    icon: ExtensionIcon,
    permissions: ['integrations:read'],
  },
  {
    id: 'teams',
    title: 'Teams',
    href: '/teams',
    icon: GroupsIcon,
    permissions: ['teams:read'],
    requiresLicense: true,
  },
  {
    id: 'support',
    title: 'Support',
    href: '/support',
    icon: HelpOutlineIcon,
    permissions: ['support:user'],
  },
  {
    id: 'settings',
    title: 'Settings',
    href: '/settings',
    icon: SettingsIcon,
    permissions: ['settings:read'],
  },
  {
    id: 'license',
    title: 'License',
    href: '/license',
    icon: VpnKeyIcon,
    permissions: ['license:read'],
  },

  // ── Admin pages ──
  {
    id: 'services',
    title: 'Services',
    href: '/admin/services',
    icon: DnsIcon,
    permissions: ['services:read'],
  },
  {
    id: 'observatory',
    title: 'Observatory',
    href: '/admin/observatory',
    icon: SpeedIcon,
    permissions: ['system:performance'],
  },
  {
    id: 'users',
    title: 'Users',
    href: '/admin/users',
    icon: PeopleAltIcon,
    permissions: ['users:read'],
  },
  {
    id: 'licenses',
    title: 'Licenses',
    href: '/admin/licenses',
    icon: VpnKeyIcon,
    permissions: ['licenses:read'],
  },
  {
    id: 'license-manager',
    title: 'License Manager',
    href: '/admin/license-manager',
    icon: WorkspacePremiumIcon,
    permissions: ['licenses:admin'],
  },
  {
    id: 'releases',
    title: 'Releases',
    href: '/admin/releases',
    icon: NewReleasesIcon,
    permissions: ['releases:admin'],
  },
  {
    id: 'prompts',
    title: 'Prompts',
    href: '/admin/prompts',
    icon: SmartToyIcon,
    permissions: ['system:admin'],
  },
  {
    id: 'admin-settings',
    title: 'Admin Settings',
    href: '/admin/settings',
    icon: TuneIcon,
    permissions: ['system:admin'],
  },
  {
    id: 'access-control',
    title: 'Access Control',
    href: '/admin/access',
    icon: SecurityIcon,
    permissions: ['system:admin'],
  },
  {
    id: 'admin-support',
    title: 'Support Tickets',
    href: '/admin/support',
    icon: SupportAgentIcon,
    permissions: ['support:admin'],
  },
  {
    id: 'admin-comms',
    title: 'Communications',
    href: '/admin/comms',
    icon: EmailOutlinedIcon,
    permissions: ['comms:read'],
  },
];

export default navItems;
