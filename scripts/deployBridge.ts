import { Address, toNano } from 'ton-core';
import { Bridge } from '../wrappers/Bridge';
import { compile, NetworkProvider } from '@ton-community/blueprint';
import { load } from 'ts-dotenv';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';

const env = load({
    WORKCHAIN: Number,
    ADMIN_ADDRESS: String,
    ORACLE_ADDRESS: String,
    FEE_ADDRESS: String,
    FEE_RATE: Number,
});

export async function run(provider: NetworkProvider) {
    const bridge = provider.open(
        new Bridge(env.WORKCHAIN, {
            adminAddr: Address.parse(env.ADMIN_ADDRESS),
            oracleAddr: Address.parse(env.ORACLE_ADDRESS),
            feeAddr: Address.parse(env.FEE_ADDRESS),
            feeRate: env.FEE_RATE,
            jettonMinterCode: JettonMinter.code,
            jettonWalletCode: JettonWallet.code,
        })
    );

    await bridge.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(bridge.address);
}
