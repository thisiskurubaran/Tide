import { parseHttpFile } from '../http/http';
import { appendRequest, parseSpec, toHttp } from './openapi';

const v3 = `openapi: 3.0.3
info: { title: Pets, version: "1.2" }
servers:
  - url: https://{region}.api.example.com/v1
    variables: { region: { default: eu } }
paths:
  /pets/{petId}:
    parameters:
      - { name: petId, in: path, schema: { type: integer } }
    get:
      summary: Get a pet
      tags: [pets]
      parameters:
        - { name: fields, in: query, required: true, schema: { type: string } }
        - { name: X-Trace, in: header, schema: { type: string } }
    patch:
      tags: [pets]
      operationId: updatePet
      deprecated: true
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Pet' }
components:
  schemas:
    Pet:
      type: object
      properties:
        name: { type: string, example: Rex }
        age: { type: integer }
        owner: { $ref: '#/components/schemas/Owner' }
        tags: { type: array, items: { type: string, enum: [good, loud] } }
    Owner:
      allOf:
        - type: object
          properties: { email: { type: string, format: email } }
        - type: object
          properties: { pet: { $ref: '#/components/schemas/Pet' } }
`;

describe('OpenAPI', () => {
  it('reads OpenAPI 3: servers, merged parameters, $refs and example bodies', () => {
    const spec = parseSpec(v3);
    expect(spec).toMatchObject({ title: 'Pets', version: '1.2', servers: ['https://eu.api.example.com/v1'] });
    const [get, patch] = spec.operations;
    expect(get).toMatchObject({ method: 'GET', path: '/pets/{petId}', summary: 'Get a pet', tag: 'pets' });
    expect(get.params.map((p) => `${p.in}:${p.name}:${p.required}`)).toEqual(['path:petId:true', 'query:fields:true', 'header:X-Trace:false']);
    expect(patch).toMatchObject({ summary: 'updatePet', deprecated: true });
    // The cycle Pet -> Owner -> Pet stops instead of recursing forever.
    expect(JSON.parse(patch.body!.example)).toEqual({ name: 'Rex', age: 0, owner: { email: 'user@example.com', pet: {} }, tags: ['good'] });
  });

  it('reads Swagger 2 JSON', () => {
    const spec = parseSpec(
      JSON.stringify({
        swagger: '2.0',
        info: { title: 'Old', version: '1' },
        host: 'api.example.com',
        basePath: '/v2',
        schemes: ['https'],
        paths: { '/users': { post: { parameters: [{ in: 'body', name: 'body', schema: { $ref: '#/definitions/User' } }] } } },
        definitions: { User: { type: 'object', properties: { id: { type: 'integer', example: 7 } } } },
      }),
    );
    expect(spec.servers).toEqual(['https://api.example.com/v2']);
    expect(spec.operations[0].body).toEqual({ contentType: 'application/json', example: '{\n  "id": 7\n}' });
  });

  it('turns an operation into a .http request that parses back', () => {
    const spec = parseSpec(v3);
    expect(toHttp(spec.operations[0])).toBe('### Get a pet\nGET {{baseUrl}}/pets/{{petId}}?fields={{fields}}\n');
    const file = appendRequest(appendRequest('', spec.operations[0], spec.servers[0]), spec.operations[1], spec.servers[0]);
    expect(file.match(/@baseUrl/g)).toHaveLength(1);
    const parsed = parseHttpFile(file);
    expect(parsed.variables.baseUrl).toBe('https://eu.api.example.com/v1');
    expect(parsed.requests.map((r) => `${r.method} ${r.url}`)).toEqual(['GET {{baseUrl}}/pets/{{petId}}?fields={{fields}}', 'PATCH {{baseUrl}}/pets/{{petId}}']);
    expect(JSON.parse(parsed.requests[1].body)).toMatchObject({ name: 'Rex' });
  });

  it('says what is wrong with other files', () => {
    expect(() => parseSpec('name: x')).toThrow('isn’t an OpenAPI');
    expect(() => parseSpec('a: [')).toThrow("couldn't be read");
  });
});
