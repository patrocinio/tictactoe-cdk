#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TictactoeAppCdkStack } from '../lib/tictactoe-app-cdk-stack';
import { TictactoeDatabaseCdkStack } from '../lib/tictactoe-database-cdk-stack';

// const REGION=[ 'us-east-1', 'us-west-2'];
const REGION=[ 'us-west-2'];

const app = new cdk.App();

// the database stack 
const dbStack = new TictactoeDatabaseCdkStack(app, 'TictactoeDatabaseCdkStack', 
                        REGION.length > 1 ? { env: { region: REGION[0] } , replicationRegions: REGION} : 
                                            { env: { region: REGION[0] } }
);

// one stack per app (auto-scaling) in each region 
for (let r of REGION) {
  new TictactoeAppCdkStack(app, `TictactoeAppCdkStack-${r}`, {
    env: { region: r },
    table: dbStack.table
  });
}

// const appStackRegion1 = new TictactoeAppCdkStack(app, `TictactoeAppCdkStack-${REGION[0]}`, {
//   env: { region: REGION[0] },
//   table: dbStack.table
// });


// const appStackRegion2 = new TictactoeAppCdkStack(app, `TictactoeAppCdkStack-${REGION[1]}`, {
//   env: { region: REGION[1] },
//   table: dbStack.table  
// });
