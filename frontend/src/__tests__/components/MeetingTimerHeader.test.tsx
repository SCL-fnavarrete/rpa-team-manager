import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MeetingTimerHeader } from '@/components/scoping/MeetingTimerHeader';

function renderTimer() {
  return render(
    <MeetingTimerHeader
      archetypes={[]}
      onSelectArchetype={() => undefined}
      onOpenArchetypeQuestions={() => undefined}
    />
  );
}

describe('MeetingTimerHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cuenta el tiempo real transcurrido aunque los ticks se atrasen (pestaña en segundo plano)', () => {
    renderTimer();
    fireEvent.click(screen.getByRole('button', { name: /play-circle/ }));

    // El navegador throttlea el intervalo: pasan 2 minutos reales pero solo llega un tick
    act(() => {
      vi.setSystemTime(Date.now() + 120_000);
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('02:01')).toBeInTheDocument();
  });

  it('pausar conserva lo acumulado y reanudar continúa desde ahí', () => {
    renderTimer();
    fireEvent.click(screen.getByRole('button', { name: /play-circle/ }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('00:05')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pause-circle/ }));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('00:05')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /play-circle/ }));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('00:08')).toBeInTheDocument();
  });

  it('reiniciar vuelve a 00:00 y detiene el cronómetro', () => {
    renderTimer();
    fireEvent.click(screen.getByRole('button', { name: /play-circle/ }));
    act(() => {
      vi.advanceTimersByTime(7000);
    });

    fireEvent.click(screen.getByRole('button', { name: /reload/ }));

    expect(screen.getByText('00:00')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /play-circle/ })).toBeInTheDocument();
  });
});
