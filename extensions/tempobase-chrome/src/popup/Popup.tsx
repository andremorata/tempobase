import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMe, getProjects, getRunningTimer, startTimer, stopTimer, adjustStartTime, updateRunningTimer, TempoBaseError } from '@/api/client';
import { notifyTimerStarted, notifyTimerStopped } from '@/background/badge';
import type { Project, TimeEntry, User } from '@/api/types';
import { API_BASE_URL } from '@/config';

interface ProjectOption {
  project: Project;
  label: string;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function Popup() {
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runningEntry, setRunningEntry] = useState<TimeEntry | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [isBillable, setIsBillable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [editingStart, setEditingStart] = useState(false);
  const [startTimeInput, setStartTimeInput] = useState('');

  const projectOptions = useMemo<ProjectOption[]>(() => {
    return projects.map((project) => ({
      project,
      label: project.client ? `${project.client.name} / ${project.name}` : project.name,
    }));
  }, [projects]);

  const selectedProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [me, projectList, running] = await Promise.all([
        getMe(),
        getProjects(),
        getRunningTimer(),
      ]);
      setUser(me);
      setProjects(projectList);
      setRunningEntry(running);

      // Keep the toolbar icon in sync with what we just fetched. This is the only
      // resync point now that the background has no periodic poll.
      if (running?.isRunning) {
        void notifyTimerStarted(running.id, running.startTime);
      } else {
        void notifyTimerStopped();
      }

      if (running) {
        setSelectedProjectId(running.projectId ?? '');
        setSelectedTaskId(running.taskId ?? '');
        setDescription(running.description ?? '');
        setIsBillable(running.isBillable);
        setStartTimeInput(formatDateTimeLocal(new Date(running.startTime)));
        const start = new Date(running.startTime).getTime();
        setElapsed(Date.now() - start);
      } else {
        const defaultProject = me.defaultProjectId
          ? projectList.find((p) => p.id === me.defaultProjectId)
          : projectList[0];
        if (defaultProject) {
          setSelectedProjectId(defaultProject.id);
          if (defaultProject.tasks.length > 0) {
            setSelectedTaskId(defaultProject.tasks[0].id);
          }
        }
      }
    } catch (err) {
      if (err instanceof TempoBaseError && err.status === 401) {
        setError('Please sign in at tempobase.pmr.dev first.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!runningEntry?.isRunning) return;
    const start = new Date(runningEntry.startTime).getTime();
    setElapsed(Date.now() - start);
    const interval = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 1000);
    return () => clearInterval(interval);
  }, [runningEntry]);

  const handleProjectChange = async (projectId: string) => {
    setSelectedProjectId(projectId);
    const project = projects.find((p) => p.id === projectId);
    const nextTaskId = project && project.tasks.length > 0 ? project.tasks[0].id : '';
    setSelectedTaskId(nextTaskId);

    if (runningEntry?.isRunning) {
      try {
        setWorking(true);
        const updated = await updateRunningTimer(runningEntry.id, {
          projectId: projectId || null,
          taskId: nextTaskId || null,
        });
        setRunningEntry(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update project');
      } finally {
        setWorking(false);
      }
    }
  };

  const handleTaskChange = async (taskId: string) => {
    setSelectedTaskId(taskId);
    if (runningEntry?.isRunning) {
      try {
        setWorking(true);
        const updated = await updateRunningTimer(runningEntry.id, { taskId: taskId || null });
        setRunningEntry(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update task');
      } finally {
        setWorking(false);
      }
    }
  };

  const handleDescriptionBlur = async () => {
    if (!runningEntry?.isRunning) return;
    try {
      setWorking(true);
      const updated = await updateRunningTimer(runningEntry.id, { description });
      setRunningEntry(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update description');
    } finally {
      setWorking(false);
    }
  };

  const handleBillableChange = async (billable: boolean) => {
    setIsBillable(billable);
    if (runningEntry?.isRunning) {
      try {
        setWorking(true);
        const updated = await updateRunningTimer(runningEntry.id, { isBillable: billable });
        setRunningEntry(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update billable');
      } finally {
        setWorking(false);
      }
    }
  };

  const handleStart = async () => {
    setWorking(true);
    setError(null);
    try {
      const entry = await startTimer({
        projectId: selectedProjectId || null,
        taskId: selectedTaskId || null,
        description,
        isBillable,
      });
      setRunningEntry(entry);
      const start = new Date(entry.startTime).getTime();
      setElapsed(Date.now() - start);
      void notifyTimerStarted(entry.id, entry.startTime);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start timer');
    } finally {
      setWorking(false);
    }
  };

  const handleStop = async () => {
    setWorking(true);
    setError(null);
    try {
      const entry = await stopTimer();
      setRunningEntry(entry);
      setElapsed(0);
      void notifyTimerStopped();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop timer');
    } finally {
      setWorking(false);
    }
  };

  const handleCancel = async () => {
    setWorking(true);
    setError(null);
    try {
      const entry = await stopTimer();
      setRunningEntry(entry);
      setElapsed(0);
      setShowCancelConfirm(false);
      void notifyTimerStopped();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel timer');
    } finally {
      setWorking(false);
    }
  };

  const handleStartTimeKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    if (!runningEntry?.isRunning) return;

    const newStart = new Date(startTimeInput);
    if (Number.isNaN(newStart.getTime())) {
      setError('Invalid start time');
      return;
    }
    if (newStart > new Date()) {
      setError('Start time cannot be in the future');
      return;
    }

    setWorking(true);
    setError(null);
    try {
      const updated = await adjustStartTime(runningEntry.id, newStart.toISOString());
      setRunningEntry(updated);
      const start = new Date(updated.startTime).getTime();
      setElapsed(Date.now() - start);
      setEditingStart(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update start time');
    } finally {
      setWorking(false);
    }
  };

  const handleStartTimeBlur = () => {
    if (runningEntry) {
      setStartTimeInput(formatDateTimeLocal(new Date(runningEntry.startTime)));
    }
    setEditingStart(false);
  };

  if (loading) {
    return (
      <div className="popup">
        <div className="popup__hint">Loading…</div>
      </div>
    );
  }

  const isRunning = runningEntry?.isRunning ?? false;

  return (
    <div className="popup">
      <header className="popup__header">
        <div className="popup__logo">
          <img src="/icon48.png" alt="TempoBase" className="popup__logo-icon" />
          TempoBase
        </div>
        <div className={isRunning ? 'popup__status popup__status--running' : 'popup__status'}>
          {isRunning ? 'Running' : 'Idle'}
        </div>
      </header>

      {error && <div className="popup__error">{error}</div>}

      {isRunning && runningEntry ? (
        <>
          <div className="popup__timer popup__timer--centered">
            <div className="popup__timer-main">
              {editingStart ? (
                <input
                  type="datetime-local"
                  className="popup__timer-input"
                  value={startTimeInput}
                  onChange={(e) => setStartTimeInput(e.target.value)}
                  onKeyDown={handleStartTimeKeyDown}
                  onBlur={handleStartTimeBlur}
                  autoFocus
                  disabled={working}
                />
              ) : (
                <div
                  className="popup__timer-duration popup__timer-duration--clickable"
                  onClick={() => setEditingStart(true)}
                  title="Click to edit start time"
                >
                  {formatDuration(elapsed)}
                </div>
              )}
              <div className="popup__timer-hint">click counter to edit start time</div>
            </div>
          </div>

          <div className="popup__section">
            <label className="popup__label" htmlFor="description">Description</label>
            <textarea
              id="description"
              className="popup__textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              placeholder="What are you working on?"
              disabled={working}
            />
          </div>

          <div className="popup__section">
            <label className="popup__label" htmlFor="project">Project</label>
            <select
              id="project"
              className="popup__select"
              value={selectedProjectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={working}
            >
              <option value="">No project</option>
              {projectOptions.map((option) => (
                <option key={option.project.id} value={option.project.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {selectedProject && selectedProject.tasks.length > 0 && (
            <div className="popup__section">
              <label className="popup__label" htmlFor="task">Task</label>
              <select
                id="task"
                className="popup__select"
                value={selectedTaskId}
                onChange={(e) => handleTaskChange(e.target.value)}
                disabled={working}
              >
                <option value="">No task</option>
                {selectedProject.tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="popup__checkbox">
            <input
              type="checkbox"
              checked={isBillable}
              onChange={(e) => handleBillableChange(e.target.checked)}
              disabled={working}
            />
            Billable
          </label>

          {showCancelConfirm ? (
            <div className="popup__confirm">
              <div className="popup__confirm-text">Cancel this timer?</div>
              <div className="popup__confirm-actions">
                <button
                  className="popup__button popup__button--secondary"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={working}
                >
                  Keep
                </button>
                <button
                  className="popup__button popup__button--danger"
                  onClick={handleCancel}
                  disabled={working}
                >
                  {working ? 'Canceling…' : 'Cancel'}
                </button>
              </div>
            </div>
          ) : (
            <div className="popup__actions">
              <button
                className="popup__button popup__button--secondary"
                onClick={() => setShowCancelConfirm(true)}
                disabled={working}
              >
                Cancel
              </button>
              <button
                className="popup__button popup__button--primary"
                onClick={handleStop}
                disabled={working}
              >
                {working ? 'Stopping…' : 'Stop Timer'}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="popup__section">
            <label className="popup__label" htmlFor="description">Description</label>
            <textarea
              id="description"
              className="popup__textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are you working on?"
              disabled={working}
            />
          </div>

          <div className="popup__section">
            <label className="popup__label" htmlFor="project">Project</label>
            <select
              id="project"
              className="popup__select"
              value={selectedProjectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={working}
            >
              <option value="">No project</option>
              {projectOptions.map((option) => (
                <option key={option.project.id} value={option.project.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {selectedProject && selectedProject.tasks.length > 0 && (
            <div className="popup__section">
              <label className="popup__label" htmlFor="task">Task</label>
              <select
                id="task"
                className="popup__select"
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                disabled={working}
              >
                <option value="">No task</option>
                {selectedProject.tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="popup__checkbox">
            <input
              type="checkbox"
              checked={isBillable}
              onChange={(e) => setIsBillable(e.target.checked)}
              disabled={working}
            />
            Billable
          </label>

          <div className="popup__actions">
            <button
              className="popup__button popup__button--primary"
              onClick={handleStart}
              disabled={working || !user}
            >
              {working ? 'Starting…' : 'Start Timer'}
            </button>
          </div>
        </>
      )}

      <div className="popup__hint">
        <a href={API_BASE_URL} target="_blank" rel="noreferrer">
          Open TempoBase
        </a>
      </div>
    </div>
  );
}
