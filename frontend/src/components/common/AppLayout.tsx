import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Button, Typography, Grid, Breadcrumb, Tag, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  ProjectOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  BulbOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FileOutlined,
  CustomerServiceOutlined,
  FundOutlined,
  KeyOutlined,
  DollarOutlined,
  BarChartOutlined,
  MenuOutlined,
  TeamOutlined,
  SearchOutlined,
  CalculatorOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { apiService } from '@/services/api';
import dayjs from 'dayjs';
import { NotificationBell } from './NotificationBell';
import { GlobalSearch } from './GlobalSearch';
import { RoleLabels, RoleColors } from '@/types/auth';
import { ThemeSelector, PaletteSelector } from './ThemeProvider';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const pageTitles: Array<{ match: (path: string) => boolean; title: string; eyebrow: string }> = [
  { match: (path) => path === '/dashboard', title: 'Inicio', eyebrow: 'RESUMEN' },
  { match: (path) => path === '/projects', title: 'Portafolio', eyebrow: 'PROYECTOS' },
  { match: (path) => path === '/cotizador', title: 'Cotizador y Levantamiento RPA', eyebrow: 'ESTIMACIÓN Y LEVANTAMIENTO' },
  { match: (path) => path === '/clients', title: 'Clientes y comerciales', eyebrow: 'CICLO COMERCIAL' },
  { match: (path) => path.startsWith('/projects/'), title: 'Ficha 360° del proyecto', eyebrow: 'PROYECTOS' },
  { match: (path) => path.startsWith('/pmo'), title: 'Centro PMO', eyebrow: 'CONTROL' },
  { match: (path) => path === '/portfolio', title: 'Cartera de proyectos', eyebrow: 'CONTROL' },
  { match: (path) => path === '/billing', title: 'Finanzas', eyebrow: 'CONTROL' },
  { match: (path) => path === '/tasks', title: 'Tareas', eyebrow: 'EJECUCIÓN' },
  { match: (path) => path === '/time', title: 'Registro de tiempo', eyebrow: 'EJECUCIÓN' },
  { match: (path) => path === '/ideas', title: 'Ideas', eyebrow: 'RECURSOS' },
  { match: (path) => path === '/files', title: 'Documentos', eyebrow: 'RECURSOS' },
  { match: (path) => path === '/support', title: 'Soporte', eyebrow: 'RECURSOS' },
  { match: (path) => path === '/admin', title: 'Equipo y acceso', eyebrow: 'ADMINISTRACIÓN' },
  { match: (path) => path === '/priorities', title: 'Prioridades', eyebrow: 'ADMINISTRACIÓN' },
  { match: (path) => path.startsWith('/settings'), title: 'Configuración', eyebrow: 'ADMINISTRACIÓN' },
  { match: (path) => path === '/profile', title: 'Mi perfil', eyebrow: 'CUENTA' }
];

export const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [activeTimer, setActiveTimer] = useState<any>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stoppingTimer, setStoppingTimer] = useState(false);
  const mobileMenuTrigger = useRef<HTMLElement | null>(null);
  const mobileDrawerRef = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { user, logout } = useAuthStore();

  const refreshGlobalTimer = useCallback(async () => {
    if (!user || user.role === 'billing') return;
    try {
      const res = await apiService.get?.('/time-entries/active');
      setActiveTimer(res || null);
    } catch {
      // Ignore polling error
    }
  }, [user]);

  useEffect(() => {
    void refreshGlobalTimer();
    const interval = setInterval(() => void refreshGlobalTimer(), 8000);
    const onTimerEvent = () => void refreshGlobalTimer();
    window.addEventListener('rpa-timer-updated', onTimerEvent);
    return () => {
      clearInterval(interval);
      window.removeEventListener('rpa-timer-updated', onTimerEvent);
    };
  }, [refreshGlobalTimer]);

  useEffect(() => {
    if (activeTimer?.date && activeTimer?.start_time) {
      const calc = () => setElapsedSeconds(Math.max(0, dayjs().diff(dayjs(`${activeTimer.date} ${activeTimer.start_time}`), 'second')));
      calc();
      const id = setInterval(calc, 1000);
      return () => clearInterval(id);
    }
    setElapsedSeconds(0);
  }, [activeTimer]);

  const formatTimerHHMMSS = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
  };

  const handleStopGlobalTimer = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeTimer) return;
    setStoppingTimer(true);
    try {
      await apiService.post('/time-entries/stop-timer');
      setActiveTimer(null);
      message.success('Cronómetro detenido y horas guardadas en tu hoja semanal');
      window.dispatchEvent(new CustomEvent('rpa-timer-updated'));
    } catch {
      message.error('No se pudo detener el cronómetro');
    } finally {
      setStoppingTimer(false);
    }
  };

  useEffect(() => {
    const drawer = mobileDrawerRef.current;
    if (drawer) drawer.inert = !mobileMenuOpen;
    if (!mobileMenuOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const trigger = mobileMenuTrigger.current;
    const frame = window.requestAnimationFrame(() => mobileDrawerRef.current?.querySelector<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !mobileDrawerRef.current) return;
      const focusable = Array.from(mobileDrawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'))
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
      else trigger?.focus();
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (screens.md && !screens.lg) setCollapsed(true);
  }, [screens.md, screens.lg]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const userMenuItems: MenuProps['items'] = [
    { key: 'profile', icon: <UserOutlined />, label: 'Mi perfil', onClick: () => navigate('/profile') },
    ...(user?.role === 'team_lead' ? [{ key: 'settings', icon: <SettingOutlined />, label: 'Configuración', onClick: () => navigate('/settings') }] : []),
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Cerrar sesión', onClick: handleLogout }
  ];

  useEffect(() => {
    if (user?.role === 'billing' && (location.pathname === '/' || location.pathname === '/dashboard')) {
      navigate('/billing', { replace: true });
    }
  }, [user?.role, location.pathname, navigate]);

  const items = useMemo<MenuProps['items']>(() => {
    if (user?.role === 'billing') {
      return [
        {
          type: 'group',
          label: 'CONTROL Y COBRANZA',
          children: [
            { key: '/pmo', icon: <FundOutlined />, label: 'Centro PMO' },
            { key: '/billing', icon: <DollarOutlined />, label: 'Cobranza y Facturación' }
          ]
        }
      ];
    }

    const roleCanSeePMO = user?.role === 'team_lead' || user?.role === 'rpa_operations';
    if (!roleCanSeePMO) {
      return [
        {
          type: 'group',
          label: 'MI DÍA A DÍA',
          children: [
            { key: '/dashboard', icon: <DashboardOutlined />, label: 'Inicio (Mi Día)' },
            { key: '/tasks', icon: <CheckSquareOutlined />, label: 'Mis Tareas' },
            { key: '/time', icon: <ClockCircleOutlined />, label: 'Registro de tiempo' }
          ]
        },
        {
          type: 'group',
          label: 'PROYECTOS Y SOPORTE',
          children: [
            { key: '/projects', icon: <ProjectOutlined />, label: 'Portafolio de proyectos' },
            { key: '/support', icon: <CustomerServiceOutlined />, label: 'Soporte RPA' },
            { key: '/cotizador', icon: <CalculatorOutlined />, label: 'Cotizador RPA' }
          ]
        },
        {
          type: 'group',
          label: 'RECURSOS',
          children: [
            { key: '/files', icon: <FileOutlined />, label: 'Documentos' },
            { key: '/ideas', icon: <BulbOutlined />, label: 'Ideas' }
          ]
        }
      ];
    }

    const main: NonNullable<MenuProps['items']> = [
      { type: 'group', label: 'ESPACIO DE TRABAJO', children: [
        { key: '/dashboard', icon: <DashboardOutlined />, label: 'Inicio' },
        { key: '/projects', icon: <ProjectOutlined />, label: 'Portafolio' },
        { key: '/tasks', icon: <CheckSquareOutlined />, label: 'Tareas' },
        { key: '/time', icon: <ClockCircleOutlined />, label: 'Registro de tiempo' },
        { key: '/cotizador', icon: <CalculatorOutlined />, label: 'Cotizador RPA' },
        { key: '/clients', icon: <TeamOutlined />, label: 'Clientes y comerciales' }
      ] },
      { type: 'group', label: 'CONTROL', children: [
        { key: '/pmo', icon: <FundOutlined />, label: 'Centro PMO' },
        ...(user?.role === 'team_lead' ? [{ key: '/portfolio', icon: <FolderOpenOutlined />, label: 'Cartera de proyectos' }] : []),
        { key: '/billing', icon: <DollarOutlined />, label: 'Finanzas' }
      ] },
      { type: 'group', label: 'RECURSOS', children: [
        { key: '/support', icon: <CustomerServiceOutlined />, label: 'Soporte' },
        { key: '/files', icon: <FileOutlined />, label: 'Documentos' },
        { key: '/ideas', icon: <BulbOutlined />, label: 'Ideas' }
      ] }
    ];

    if (user?.role === 'team_lead') {
      main.push({ type: 'group', label: 'ADMINISTRACIÓN', children: [
        { key: '/admin', icon: <UserOutlined />, label: 'Equipo y acceso' },
        { key: '/priorities', icon: <BarChartOutlined />, label: 'Prioridades' },
        { key: 'configuration', icon: <SettingOutlined />, label: 'Configuración', children: [
          { key: '/settings', icon: <DollarOutlined />, label: 'General' },
          { key: '/settings/llm', icon: <KeyOutlined />, label: 'Integraciones IA' }
        ] }
      ] });
    }
    return main;
  }, [user?.role]);

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key.startsWith('/')) {
      navigate(key);
      setMobileMenuOpen(false);
    }
  };

  const page = pageTitles.find(({ match }) => match(location.pathname)) || {
    title: 'RPA Team Manager', eyebrow: 'ESPACIO DE TRABAJO'
  };
  const showBreadcrumb = location.pathname !== '/dashboard' && !location.pathname.startsWith('/projects/');
  const selectedKey = location.pathname.startsWith('/projects/') ? '/projects'
    : location.pathname.startsWith('/pmo') ? '/pmo'
      : location.pathname.startsWith('/settings') ? '/settings'
        : location.pathname;

  const navigation = (
    <>
      <div className="app-brand">
        <div className="app-brand-mark" aria-hidden="true">R</div>
        {!collapsed && <div className="app-brand-copy"><Text strong>RPA Manager</Text><Text type="secondary">OFICINA DE PROYECTOS</Text></div>}
      </div>
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        defaultOpenKeys={['configuration']}
        items={items}
        onClick={handleMenuClick}
        className="app-navigation"
        inlineCollapsed={collapsed && !isMobile}
      />
      {!collapsed && <div className="app-sidebar-note"><span className="app-sidebar-note-dot" />Sistema operativo<Text type="secondary">Todos los módulos disponibles</Text></div>}
    </>
  );

  return (
    <Layout className="app-shell">
      {!isMobile && <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={252}
        collapsedWidth={76}
        className="app-sider"
      >
        {navigation}
        <Button
          className="app-collapse-button"
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          aria-label={collapsed ? 'Expandir navegación' : 'Contraer navegación'}
          onClick={() => setCollapsed(!collapsed)}
        />
      </Sider>}

      <Layout className="app-main-layout">
        <a className="app-skip-link" href="#main-content">Saltar al contenido principal</a>
        <Header className="app-header">
          {isMobile && <Button ref={mobileMenuTrigger as React.Ref<HTMLButtonElement>} type="text" aria-label="Abrir navegación" aria-expanded={mobileMenuOpen} aria-controls="mobile-navigation" icon={<MenuOutlined />} onClick={() => setMobileMenuOpen(true)} />}
          <div className="app-page-heading">
            {showBreadcrumb && <Breadcrumb items={[
              { title: <button className="app-breadcrumb-link" onClick={() => navigate('/dashboard')}>Inicio</button> },
              { title: page.title }
            ]} />}
            <Typography.Title level={4}>{page.title}</Typography.Title>
          </div>
          <div className="app-header-actions">
            {activeTimer && (
              <Tag
                color="success"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '2px 10px',
                  cursor: 'pointer',
                  marginInlineEnd: 0
                }}
                onClick={() => navigate('/time')}
              >
                <PlayCircleOutlined spin />
                <Text strong style={{ fontFamily: 'monospace' }}>
                  {formatTimerHHMMSS(elapsedSeconds)}
                </Text>
                {!isMobile && (
                  <Text ellipsis style={{ maxWidth: 140 }}>
                    {activeTimer.project_name || `Proyecto #${activeTimer.project_id}`}
                  </Text>
                )}
                <Tooltip title="Detener cronómetro y guardar horas">
                  <Button
                    type="primary"
                    danger
                    size="small"
                    icon={<PauseCircleOutlined />}
                    loading={stoppingTimer}
                    onClick={handleStopGlobalTimer}
                  >
                    {!isMobile ? 'Detener' : ''}
                  </Button>
                </Tooltip>
              </Tag>
            )}
            <PaletteSelector />
            <ThemeSelector />
            <div className={`app-search-slot${mobileSearchOpen ? ' is-mobile-open' : ''}`}><GlobalSearch /></div>
            {isMobile && <Button type="text" aria-label={mobileSearchOpen ? 'Cerrar búsqueda' : 'Abrir búsqueda'} aria-expanded={mobileSearchOpen} icon={<SearchOutlined />} onClick={() => setMobileSearchOpen((open) => !open)} />}
            <NotificationBell />
            <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
              <Button type="text" className="app-user-button">
                <Avatar size={36} style={{ backgroundColor: user ? RoleColors[user.role] : 'var(--color-info)' }}>{user?.full_name?.charAt(0)?.toUpperCase() || <UserOutlined />}</Avatar>
                <span className="app-user-copy"><Text strong>{user?.full_name || 'Usuario'}</Text><Text type="secondary">{user ? RoleLabels[user.role] : 'Cargando…'}</Text></span>
              </Button>
            </Dropdown>
          </div>
        </Header>

        <Content className="app-content" id="main-content" tabIndex={-1} role="main" aria-label="Contenido principal">
          <div className="app-content-inner"><Outlet /></div>
        </Content>
      </Layout>

      {isMobile && <>
        {mobileMenuOpen && <button className="app-mobile-scrim" aria-label="Cerrar navegación" tabIndex={-1} onClick={() => setMobileMenuOpen(false)} />}
        <aside ref={mobileDrawerRef} id="mobile-navigation" className={`app-mobile-drawer${mobileMenuOpen ? ' is-open' : ''}`} aria-label="Navegación principal" aria-hidden={!mobileMenuOpen}>
          <div className="app-mobile-drawer-head">
            <div className="app-brand-mark" aria-hidden="true">R</div>
            <Button type="text" icon={<MenuFoldOutlined />} aria-label="Cerrar navegación" onClick={() => setMobileMenuOpen(false)} />
          </div>
          {navigation}
        </aside>
      </>}
    </Layout>
  );
};
