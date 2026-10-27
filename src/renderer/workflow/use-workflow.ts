import { useCallback, useEffect, useRef, useState } from 'react';
import type { MelinnaApi } from '../../shared/ipc-contract';
import type { WorkflowSnapshot } from '../../shared/workflow-api';
import { emptyWorkflow } from '../../shared/workflow-api';
import { errorMessage, unwrap } from '../api';
export function useWorkflow(api: MelinnaApi) {
  const [data, setData] = useState<WorkflowSnapshot>(() => emptyWorkflow());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!api.workflow) return;
    const request = ++seq.current;
    try {
      const value = await unwrap(api.workflow.snapshot());
      if (request === seq.current) {
        setData(value);
        setError(null);
        setLoaded(true);
      }
    } catch (err) {
      if (request === seq.current) setError(errorMessage(err));
    }
  }, [api]);
  useEffect(() => {
    void reload();
    const off = api.workflow?.onChange(() => void reload());
    return () => {
      seq.current++;
      off?.();
    };
  }, [api, reload]);
  return { data, error, loaded, reload };
}
