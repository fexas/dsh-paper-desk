/**
 * Wire contract mounted by the browser half. The Host uses Typert's source-mode
 * Remote metadata; these descriptors give the Client a typed namespace and the
 * strict codecs `$mount` requires.
 */
import { z } from 'zod';

const strict = (typeSymbol, schema) => ({
  mode: 'strict',
  typeSymbol,
  schema,
  create: () => schema,
});

const parameter = (name) => ({
  name,
  wire: name,
  source: 'json',
  codec: strict(`dsh-paper-desk/types#${name}`, z.any()),
});

const result = (method) => strict(`dsh-paper-desk/types#${method}:result`, z.any());

const descriptor = (method, parameters) => ({
  id: `dsh-paper-desk#paperDesk/${method}`,
  service: 'paperDesk',
  namespace: 'paperDesk',
  method,
  invocation: { kind: 'direct' },
  parameters: parameters.map(parameter),
  result: result(method),
});

export const TYPERT_REMOTE = {
  package: 'dsh-paper-desk',
  descriptors: [
    descriptor('listProjects', []),
    descriptor('clientReady', ['version']),
    descriptor('createProject', ['name', 'type']),
    descriptor('renameProject', ['projectId', 'name']),
    descriptor('deleteProject', ['projectId']),
    descriptor('getProject', ['projectId']),
    descriptor('getMindmap', ['projectId']),
    descriptor('saveMindmap', ['projectId', 'mapJson']),
    descriptor('mindmapChat', ['projectId', 'text', 'selectedNodeIdsJson']),
    descriptor('clearMindmapChat', ['projectId']),
    descriptor('beginPaper', ['projectId', 'filename', 'size']),
    descriptor('beginAttachment', ['projectId', 'paperId', 'filename', 'size', 'mime']),
    descriptor('putUploadChunk', ['uploadId', 'index', 'dataBase64']),
    descriptor('finishUpload', ['uploadId']),
    descriptor('updatePaper', ['projectId', 'paperId', 'patchJson']),
    descriptor('deletePaper', ['projectId', 'paperId']),
    descriptor('deleteAttachment', ['projectId', 'paperId', 'attachmentId']),
    descriptor('getReaderData', ['projectId', 'paperId']),
    descriptor('savePaperText', ['projectId', 'paperId', 'text']),
    descriptor('generateNotes', ['projectId', 'paperId', 'force']),
    descriptor('noteProgress', ['projectId', 'paperId']),
    descriptor('saveNotes', ['projectId', 'paperId', 'markdown']),
    descriptor('saveAnnotations', ['projectId', 'paperId', 'annotationsJson']),
    descriptor('chat', ['projectId', 'paperId', 'text', 'quote', 'page']),
    descriptor('clearChat', ['projectId', 'paperId']),
    descriptor('translate', ['projectId', 'paperId', 'text', 'page']),
    descriptor('readPaperChunk', ['projectId', 'paperId', 'kind', 'offset', 'length']),
  ],
};

export default TYPERT_REMOTE;
