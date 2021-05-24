import * as pulumi from '@pulumi/pulumi'
import * as gcp from '@pulumi/gcp'

// Create a network
const computeInstance = createComputeInstance()
createAlertToAutomaticallyShutdownIdleInstance(computeInstance)

// Export the name and IP address of the Instance
exports.instanceName = computeInstance.name
exports.instanceIP = computeInstance.networkInterfaces.apply((networkInterface) => {
  return networkInterface[0].accessConfigs?.[0].natIp
})

function createComputeInstance() {
  const network = new gcp.compute.Network('network')
  const computeFirewall = new gcp.compute.Firewall('firewall', {
    network: network.id,
    allows: [
      {
        protocol: 'tcp',
        ports: ['22'],
      },
    ],
  })

  // Create a Virtual Machine Instance
  const computeInstance = new gcp.compute.Instance('instance', {
    name: 'code-server',
    machineType: 'n2d-standard-2',
    zone: 'us-central1-a',
    bootDisk: { initializeParams: { image: 'ubuntu-os-cloud/ubuntu-2104' } },
    networkInterfaces: [
      {
        network: network.id,
        networkIp: '',
      },
    ],
    scheduling: {
      automaticRestart: false,
      preemptible: true,
    },
  })
  return computeInstance
}

// Create alert to automatically shutdown instances when not using
async function createAlertToAutomaticallyShutdownIdleInstance(
  computeInstance: gcp.compute.Instance
) {
  const pubSubTopic = new gcp.pubsub.Topic('shutdown-idle-instance')
  authorizeMonitoringServiceToPublishToTopic(pubSubTopic)
  const notificationChannel = await createNotificationChannel(pubSubTopic)
  createAlertPolicy(notificationChannel, computeInstance)
  createCloudFunction(pubSubTopic, computeInstance)
}

function authorizeMonitoringServiceToPublishToTopic(pubSubTopic: gcp.pubsub.Topic) {
  const project = gcp.organizations.getProject({})
  project.then((project) => {
    new gcp.pubsub.TopicIAMBinding('binding', {
      project: pubSubTopic.project,
      topic: pubSubTopic.name,
      role: 'roles/pubsub.publisher',
      members: [
        `serviceAccount:service-${project.number}@gcp-sa-monitoring-notification.iam.gserviceaccount.com`,
      ],
    })
  })
}

async function createNotificationChannel(pubSubTopic: gcp.pubsub.Topic) {
  const project = gcp.organizations.getProject({})
  return project.then((project) => {
    return new gcp.monitoring.NotificationChannel('notificationChannel', {
      displayName: 'Pub/Sub Notification Channel',
      labels: {
        topic: pulumi.interpolate`projects/${project.name}/topics/${pubSubTopic.name}`,
      },
      type: 'pubsub',
    })
  })
}

function createAlertPolicy(
  notificationChannel: gcp.monitoring.NotificationChannel,
  computeInstance: gcp.compute.Instance
) {
  return new gcp.monitoring.AlertPolicy('alertPolicy', {
    combiner: 'OR',
    conditions: [
      {
        conditionThreshold: {
          comparison: 'COMPARISON_LT',
          trigger: {
            percent: 100,
          },
          duration: 30 * 60 + 's',
          thresholdValue: 300 * 1024,
          filter: computeInstance.instanceId.apply((instanceId) => {
            return (
              'metric.type="compute.googleapis.com/instance/network/received_bytes_count"' +
              ' AND resource.type="gce_instance"' +
              ` AND resource.labels.instance_id="${instanceId}"`
            )
          }),
          aggregations: [
            {
              alignmentPeriod: 5 * 60 + 's',
              perSeriesAligner: 'ALIGN_MEAN',
            },
          ],
        },
        displayName: 'Low received bytes',
      },
    ],
    notificationChannels: [notificationChannel.name],
    displayName: 'Automatically shutdown when idle',
  })
}

function createCloudFunction(pubSubTopic: gcp.pubsub.Topic, computeInstance: gcp.compute.Instance) {
  pubSubTopic.onMessagePublished('onShutdownIdleInstance', {
    runtime: 'nodejs14',
    callback(data) {
      console.log('hey I am shutting you down baby.')
    },
  })
}
