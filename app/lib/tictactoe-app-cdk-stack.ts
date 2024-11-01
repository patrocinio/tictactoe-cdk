import { Duration, CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { aws_dynamodb as dynamodb } from 'aws-cdk-lib';

import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { aws_autoscaling as autoscaling } from 'aws-cdk-lib';
import { aws_elasticloadbalancingv2 as elbv2 } from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';

export interface ASGProps extends StackProps {
  table: dynamodb.Table
}

export class TictactoeAppCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: ASGProps) {
    super(scope, id, props);

    /********************************************
     * Create the network
     ********************************************/

    // the network for our app 
    const vpc = new ec2.Vpc(this, 'TicTacToeVPC', {
      natGateways: 1, //default value but better to make it explicit
      maxAzs: 2,
      subnetConfiguration: [{
        subnetType: ec2.SubnetType.PUBLIC,
        name: 'load balancer',
        cidrMask: 24,
      }, {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        name: 'application',
        cidrMask: 24
      }]
    });

    /********************************************
     * Create the auto scaling group with EC2 
     * instances to deploy our app
     ********************************************/


    //
    // define the IAM role that will allow the application EC2 instance to access our DynamoDB Table 
    //
    const dynamoDBRole = new iam.Role(this, 'TicTacToeRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
    });
    // allow the role to read / write on the table
    props?.table.grantReadWriteData(dynamoDBRole);

    //
    // define a user data script to install & launch a web server on the application instance
    //
    const installAppUserdata = ec2.UserData.forLinux();
    installAppUserdata.addCommands(
      'wget https://github.com/sebsto/tictactoe-dynamodb/releases/download/v02/tictactoe-app.zip',
      'mkdir tictactoe-app && cd tictactoe-app',

      'unzip ../tictactoe-app.zip',
      'python3 -m venv .venv',
      'source .venv/bin/activate',
      'pip3 install -r requirements.txt',

      'USE_EC2_INSTANCE_METADATA=true python3 application.py --serverPort 8080'
    );

    const securityGroup = new ec2.SecurityGroup(this, 'TicTacToeSecurityGroup', {
      vpc
    })

    const launchTemplate = new ec2.LaunchTemplate(this, 'TicTacToeLaunchTemplate', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),

      // get the latest Amazon Linux 2023 image for ARM64 CPU 
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),

      // role granting permission to read / write to DynamoDB table 
      role: dynamoDBRole,

      // script to automatically install the app at boot time 
      userData: installAppUserdata,

      securityGroup: securityGroup
    })

    const asg = new autoscaling.AutoScalingGroup(this, 'TicTacToeASG', {
      vpc,
      launchTemplate: launchTemplate,

      // for high availability 
      minCapacity: 2,

      // we trust the health check from the load balancer
      healthCheck: autoscaling.HealthCheck.elb( {
        grace: Duration.seconds(30)
      } )
    });

    // Create an IAM permission to allow the instances to connect to SSM 
    // just in case I need to debug the user data script  
    const ssmPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore");
    asg.role.addManagedPolicy(ssmPolicy)

    /********************************************
     * Create the load balancer
     ********************************************/

    // Create the load balancer in our VPC. 'internetFacing' is 'false'
    // by default, which creates an internal load balancer.
    const lb = new elbv2.ApplicationLoadBalancer(this, 'TicTacToeLB', {
      vpc,
      internetFacing: true
    });

    // Add a listener and open up the load balancer's security group
    // to the world.
    const listener = lb.addListener('TicTacToeListener', {
      port: 80,

      // 'open: true' is the default, you can leave it out if you want. Set it
      // to 'false' and use `listener.connections` if you want to be selective
      // about who can access the load balancer.
      open: true,
    });

    // Add the auto scaling group as a load balancing
    // target to the listener.
    listener.addTargets('TicTacToeFleet', {
      port: 8080,
      stickinessCookieDuration: Duration.hours(1),
      targets: [asg]
    });    

    // output the Load Balancer DNS Name for easy retrieval
    new CfnOutput(this, 'LoadBalancerDNSName', { value: lb.loadBalancerDnsName });

    // output for easy integration with other AWS services 
    new CfnOutput(this, 'ARNLoadBalancer', { value: lb.loadBalancerArn });
    new CfnOutput(this, 'HostedZoneLoadBalancer', { value: lb.loadBalancerCanonicalHostedZoneId });
    new CfnOutput(this, 'ARNAutoScalingGroup', { value: asg.autoScalingGroupArn });
  }
}
