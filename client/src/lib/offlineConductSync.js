import {
  createResponseUploadSession,
  finalizeResponseUploadSession,
  getResponseUploadSessionStatus,
  uploadResponseAudioChunk,
} from '../api';
import {
  deleteConductSession,
  getAudioChunk,
  listAudioChunkIndexes,
  listPendingConductSessions,
  patchConductSession,
} from './offlineConductStore';
import { appendOfflineLog } from './offlineConductLog';

export async function syncPendingConductSession(session) {
  if (!session || session.status === 'active') {
    return { skipped: true };
  }
  appendOfflineLog('Начата попытка догрузки проведения', {
    localSessionId: session.localSessionId,
    surveyId: session.surveyId,
    status: session.status,
  });

  await patchConductSession(session.localSessionId, {
    status: 'uploading',
    lastError: null,
  });

  try {
    let uploadSessionId = session.uploadSessionId || null;
    if (!uploadSessionId) {
      const created = await createResponseUploadSession(session.surveyId, {
        clientSessionId: session.localSessionId,
        audioMime: session.audioMime || null,
        audioDurationSec: session.audioDurationSec || 0,
      });
      uploadSessionId = created.uploadSessionId;
      await patchConductSession(session.localSessionId, {
        uploadSessionId,
        serverStatus: created.status,
      });
      appendOfflineLog('Создана серверная upload-сессия', {
        localSessionId: session.localSessionId,
        uploadSessionId,
      });
      if (created.responseId) {
        await deleteConductSession(session.localSessionId);
        appendOfflineLog('Проведение уже было догружено ранее', {
          localSessionId: session.localSessionId,
          responseId: created.responseId,
        });
        return { uploaded: true, responseId: created.responseId, reused: true };
      }
    }

    const remoteStatus = await getResponseUploadSessionStatus(
      session.surveyId,
      uploadSessionId
    );
    if (remoteStatus.responseId) {
      await deleteConductSession(session.localSessionId);
      appendOfflineLog('Сервер подтвердил ранее завершённую загрузку', {
        localSessionId: session.localSessionId,
        responseId: remoteStatus.responseId,
      });
      return { uploaded: true, responseId: remoteStatus.responseId, reused: true };
    }

    const localChunkIndexes = session.hasAudio
      ? await listAudioChunkIndexes(session.localSessionId)
      : [];
    const remoteChunkIndexes = new Set(remoteStatus.uploadedChunkIndexes || []);

    for (const chunkIndex of localChunkIndexes) {
      if (remoteChunkIndexes.has(chunkIndex)) continue;
      const chunk = await getAudioChunk(session.localSessionId, chunkIndex);
      if (!chunk?.blob) {
        throw new Error(`Не найден локальный аудиофрагмент ${chunkIndex + 1}`);
      }
      await uploadResponseAudioChunk(session.surveyId, uploadSessionId, {
        chunkIndex,
        chunkBlob: chunk.blob,
        audioDurationSec: session.audioDurationSec || 0,
      });
      appendOfflineLog('Загружен аудиофрагмент', {
        localSessionId: session.localSessionId,
        uploadSessionId,
        chunkIndex,
      });
      remoteChunkIndexes.add(chunkIndex);
      await patchConductSession(session.localSessionId, {
        uploadSessionId,
        uploadedChunkIndexes: [...remoteChunkIndexes].sort((a, b) => a - b),
      });
    }

    const finalized = await finalizeResponseUploadSession(
      session.surveyId,
      uploadSessionId,
      {
        payload: {
          respondentNote: session.respondentNote || '',
          answers: session.answers || [],
        },
        totalChunks: localChunkIndexes.length,
        hasAudio: !!session.hasAudio,
      }
    );
    await deleteConductSession(session.localSessionId);
    appendOfflineLog('Проведение успешно догружено и завершено', {
      localSessionId: session.localSessionId,
      responseId: finalized.id,
    });
    return { uploaded: true, responseId: finalized.id, finalized };
  } catch (err) {
    const currentRetry = Number(session.retryCount) || 0;
    await patchConductSession(session.localSessionId, {
      status: 'failed',
      retryCount: currentRetry + 1,
      lastError: err.message || 'Не удалось отправить проведение',
      lastAttemptAt: new Date().toISOString(),
    });
    appendOfflineLog('Ошибка догрузки проведения', {
      localSessionId: session.localSessionId,
      error: err.message || 'Неизвестная ошибка',
    });
    throw err;
  }
}

export async function syncAllPendingConductSessions() {
  const sessions = await listPendingConductSessions();
  const queue = sessions.filter((item) => item.status !== 'active');
  const results = [];
  for (const session of queue) {
    try {
      results.push(await syncPendingConductSession(session));
    } catch (err) {
      results.push({ error: err, localSessionId: session.localSessionId });
    }
  }
  return results;
}
