import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Space, Typography, Button, Tag, Select, Tooltip, Progress, theme } from 'antd';
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined, 
  ReloadOutlined, 
  ClockCircleOutlined, 
  ThunderboltOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import { RPAArchetype } from '../../types/scoping';

const { Text, Title } = Typography;

interface MeetingTimerHeaderProps {
  archetypes: RPAArchetype[];
  selectedArchetypeId?: string;
  onSelectArchetype: (archetype: RPAArchetype) => void;
  onOpenArchetypeQuestions: () => void;
}

export const MeetingTimerHeader: React.FC<MeetingTimerHeaderProps> = ({
  archetypes,
  selectedArchetypeId,
  onSelectArchetype,
  onOpenArchetypeQuestions
}) => {
  const { token } = theme.useToken();
  const isDark = typeof document !== 'undefined' && (
    document.documentElement.dataset.theme === 'dark' ||
    token.colorBgBase === '#0F0F10' ||
    token.colorBgContainer === '#171718' ||
    token.colorBgElevated === '#262626'
  );

  const [seconds, setSeconds] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // El tiempo se mide con el reloj y no contando ticks: el navegador atrasa los intervalos
  // de una pestaña en segundo plano y el cronómetro quedaría corto.
  const accumulatedMsRef = useRef<number>(0); // tramos ya cerrados (pausas)
  const startedAtRef = useRef<number | null>(null); // inicio del tramo en curso

  const getElapsedSeconds = useCallback((): number => {
    const running = startedAtRef.current === null ? 0 : Date.now() - startedAtRef.current;
    return Math.floor((accumulatedMsRef.current + running) / 1000);
  }, []);

  useEffect(() => {
    if (!isRunning) return undefined;
    const interval = setInterval(() => setSeconds(getElapsedSeconds()), 1000);
    return () => clearInterval(interval);
  }, [isRunning, getElapsedSeconds]);

  const handleStart = () => {
    startedAtRef.current = Date.now();
    setIsRunning(true);
  };

  const handlePause = () => {
    if (startedAtRef.current !== null) {
      accumulatedMsRef.current += Date.now() - startedAtRef.current;
      startedAtRef.current = null;
    }
    setIsRunning(false);
    setSeconds(getElapsedSeconds());
  };

  const handleReset = () => {
    accumulatedMsRef.current = 0;
    startedAtRef.current = null;
    setIsRunning(false);
    setSeconds(0);
  };

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const currentMinutes = seconds / 60;
  const progressPercent = Math.min(100, Math.round((seconds / 900) * 100)); // 15 mins = 900 secs

  // Etapa sugerida según minuto de reunión
  let phaseInfo = {
    phase: 'Min 1-4: Contexto y Factibilidad Base',
    color: 'blue',
    hint: 'Explorar trigger del proceso, entradas de datos y si hay 100% de reglas o criterio humano.'
  };

  if (currentMinutes >= 12) {
    phaseInfo = {
      phase: 'Min 13-15: Cierre, Alcance y Expectativas',
      color: 'gold',
      hint: 'Revisar viabilidad inmediata, advertir dependencias y acordar envío de propuesta.'
    };
  } else if (currentMinutes >= 8) {
    phaseInfo = {
      phase: 'Min 9-12: Volumetría y Ahorro (ROI)',
      color: 'purple',
      hint: 'Preguntar frecuencia, volumen por ciclo, tiempo por transacción (AHT) y FTEs actuales.'
    };
  } else if (currentMinutes >= 4) {
    phaseInfo = {
      phase: 'Min 5-8: Sistemas y Complejidad Técnica',
      color: 'orange',
      hint: 'Preguntar ERP (SAP, Dynamics, Softland), si es Citrix/VDI (+60% esfuerzo) y si hay OCR.'
    };
  }

  const selectedArchetype = archetypes.find((a) => a.id === selectedArchetypeId);

  return (
    <Card 
      styles={{ body: { padding: '16px 20px' } }}
      style={{
        marginBottom: 16,
        border: `1px solid ${token.colorBorderSecondary}`,
        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorBgContainer
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        {/* Lado izquierdo: Selector de plantilla rápida */}
        <Space direction="vertical" size={2} style={{ flex: '1 1 320px' }}>
          <Space align="center">
            <ThunderboltOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />
            <Text strong style={{ fontSize: 15 }}>
              Plantilla Rápida de Proceso (Arquetipo)
            </Text>
            <Tooltip title="Seleccionar una plantilla pre-carga el 70% de las variables típicas según procesos estándar probados en la industria.">
              <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
            </Tooltip>
          </Space>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select
              aria-label="Plantilla rápida de proceso"
              style={{ minWidth: 280, flex: 1 }}
              placeholder="Seleccionar plantilla..."
              value={selectedArchetypeId || undefined}
              onChange={(value) => {
                const found = archetypes.find((a) => a.id === value);
                if (found) onSelectArchetype(found);
              }}
              options={archetypes.map((a) => ({
                value: a.id,
                label: `${a.name} (${a.category})`
              }))}
            />
            {selectedArchetype && (
              <Button 
                size="middle" 
                onClick={onOpenArchetypeQuestions}
                icon={<InfoCircleOutlined />}
              >
                Preguntas Clave ({selectedArchetype.recommended_questions.length})
              </Button>
            )}
          </div>
        </Space>

        {/* Lado derecho: Cronómetro y asistente de 15 minutos */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 16,
          padding: '8px 16px',
          borderRadius: 8,
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : token.colorFillAlter,
          border: `1px solid ${token.colorBorderSecondary}`
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ClockCircleOutlined style={{ color: isRunning ? token.colorSuccess : token.colorTextSecondary }} />
              <Title level={4} style={{ margin: 0, fontFamily: 'monospace' }}>
                {formatTime(seconds)}
              </Title>
              <Text type="secondary" style={{ fontSize: 12 }}>/ 15:00 min</Text>
              <Tag color={phaseInfo.color}>{phaseInfo.phase.split(':')[0]}</Tag>
            </div>
            <div style={{ width: 180, marginTop: 4 }}>
              <Progress 
                percent={progressPercent} 
                showInfo={false} 
                size="small" 
                strokeColor={progressPercent > 90 ? token.colorError : token.colorPrimary} 
              />
            </div>
          </div>

          <Space size={4}>
            {!isRunning ? (
              <Tooltip title="Iniciar cronómetro de reunión">
                <Button 
                  type="primary" 
                  shape="circle" 
                  icon={<PlayCircleOutlined />} 
                  onClick={handleStart} 
                />
              </Tooltip>
            ) : (
              <Tooltip title="Pausar cronómetro">
                <Button 
                  shape="circle" 
                  icon={<PauseCircleOutlined />} 
                  onClick={handlePause} 
                />
              </Tooltip>
            )}
            <Tooltip title="Reiniciar cronómetro">
              <Button 
                shape="circle" 
                icon={<ReloadOutlined />} 
                onClick={handleReset} 
              />
            </Tooltip>
          </Space>
        </div>
      </div>

      {/* Franja de guía táctica contextual */}
      <div style={{ 
        marginTop: 10, 
        paddingTop: 8, 
        borderTop: `1px dashed ${token.colorBorderSecondary}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8
      }}>
        <Space size={6}>
          <Text strong style={{ fontSize: 12 }}>Objetivo actual:</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{phaseInfo.hint}</Text>
        </Space>
        {selectedArchetype && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Sistemas típicos: <Text strong style={{ fontSize: 12 }}>{selectedArchetype.typical_systems}</Text>
          </Text>
        )}
      </div>
    </Card>
  );
};
