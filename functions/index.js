const Compute = require("@google-cloud/compute")
const compute = new Compute()

/**
 *
 * @param {import('express').Request} request
 * @param {import('express').Response} response
 */
exports.startCodeServer = async (request, response) => {
  if (!isAuthenticated(request)) {
    return response.status(401).send()
  }

  await startInstance()
  const message = "Starting code-server instance."
  response.status(200).send(message)
}

/**
 *
 * @param {import('express').Request} request
 */
function isAuthenticated(request) {
  const tokenHeader = request.get("Authorization") || ""
  return secureCompare(`token ${process.env.AUTH_SECRET}`, tokenHeader)
}

// https://snyk.io/blog/node-js-timing-attack-ccc-ctf/
function secureCompare(a, b) {
  let mismatch = 0
  for (let i = 0; i < a.length; ++i) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return !mismatch
}

async function startInstance() {
  // https://cloud.google.com/scheduler/docs/start-and-stop-compute-engine-instances-on-a-schedule#set_up_the_functions_with
  const [vms] = await compute.getVMs({ filter: `id eq ${process.env.CODE_SERVER_INSTANCE_ID}` })
  await Promise.all(
    vms.map(async (instance) => {
      const [operation] = await instance.start()

      // Operation pending
      return operation.promise()
    })
  )
}
