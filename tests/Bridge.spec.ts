import { Blockchain, TreasuryContract } from '@ton-community/sandbox';
import { Address, Dictionary, toNano } from 'ton-core';
import { Bridge } from '../wrappers/Bridge';
import '@ton-community/test-utils';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { buildTokenMetadataCell } from './helpers';
import { SandboxContract } from '@ton-community/sandbox/dist/blockchain/Blockchain';

describe('Bridge', () => {
    let blockchain: Blockchain;
    let bridge: SandboxContract<Bridge>;

    let admin: SandboxContract<TreasuryContract>;
    let oracle: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;

    // Some test data
    const jettonCoinId = 1729;
    const metadata = buildTokenMetadataCell({
        name: 'Synthetic TZS',
        symbol: 'bTZS',
        image: 'https://example.com/image.png',
        description: 'some description for the test jetton',
    });

    beforeAll(async () => {
        blockchain = await Blockchain.create();

        admin = await blockchain.treasury('admin');
        oracle = await blockchain.treasury('oracle');
        user = await blockchain.treasury('random-user');

        bridge = blockchain.openContract(
            new Bridge(-1, {
                adminAddr: admin.address,
                oracleAddr: oracle.address,
                feeAddr: admin.address,
                feeRate: 1,
                jettonMinterCode: JettonMinter.code,
                jettonWalletCode: JettonWallet.code,
            })
        );

        const deployResult = await bridge.sendDeploy(admin.getSender(), toNano('10.0'));

        expect(deployResult.transactions).toHaveTransaction({
            from: admin.address,
            to: bridge.address,
            deploy: true,
        });
    });

    it('should deploy', async () => {
        const stack = await bridge.getBridgeDataStack();

        expect(stack.readNumber()).toEqual(0); // admin address workchain
        expect(stack.readBigNumber().toString(16)).toEqual(admin.address.hash.toString('hex')); // admin address hash

        // Check that oracle was added to the bridge.
        expect(
            stack
                .readCell()
                .beginParse()
                .loadDictDirect(
                    Dictionary.Keys.Buffer(32),
                    Dictionary.Values.Dictionary(Dictionary.Keys.Uint(32), Dictionary.Values.BigUint(160))
                )
                .has(oracle.address.hash)
        ).toBeTruthy();

        expect(stack.pop().type).toEqual('null'); // empty jettons dict
        expect(stack.pop().type).toEqual('cell'); // jetton minter code
        expect(stack.pop().type).toEqual('cell'); // jetton wallet code
    });

    it('should lock TONs and emit log message', async () => {
        const destinationAddress = 0x142d6db735cdb50bfc6ec65f94830320c6c7a245n;
        const value = toNano(2);

        const res = await bridge.sendLock(user.getSender(), {
            value,
            destinationAddress,
            destinationCoinId: jettonCoinId,
        });

        expect(res.transactions).toHaveTransaction({
            outMessagesCount: 1,
            success: true,
        });

        const resp = res.transactions[res.transactions.length - 1].outMessages;
        const cs = resp.get(0)?.body.beginParse()!;

        const logDestinationAddress = cs.loadUintBig(160).toString(16);
        const logDestinationCoinId = cs.loadUint(32);
        const logFromAddressHash = cs.loadUintBig(256).toString(16);
        const logFromAddress = Address.parseRaw(bridge.address.workChain + ':' + logFromAddressHash);
        const logMsgValue = cs.loadCoins();

        expect(logDestinationAddress).toEqual(destinationAddress.toString(16));
        expect(logDestinationCoinId).toEqual(jettonCoinId);
        expect(logFromAddress.equals(user.address)).toBeTruthy;
        expect(logMsgValue).toEqual(value);
    });

    it('should unlock TONs to destination address', async () => {
        const destinationAddress = user.address;
        const amount = toNano(2);

        const res = await bridge.sendUnlock(oracle.getSender(), {
            address: destinationAddress,
            amount: amount,
        });

        expect(res.transactions).toHaveTransaction({
            from: bridge.address,
            to: destinationAddress,
            success: true,
        });
    });

    it('should fail to unlock TONs because of non oracle account', async () => {
        const destinationAddress = user.address;
        const amount = toNano(2);

        const res = await bridge.sendUnlock(admin.getSender(), {
            address: destinationAddress,
            amount: amount,
        });

        expect(res.transactions).toHaveTransaction({
            from: admin.address,
            to: bridge.address,
            success: false,
            exitCode: 402,
        });
    });

    it('should add new jetton to bridge', async () => {
        const expectedMinterAddress = JettonMinter.calculateAddress(0, bridge.address, metadata);

        const res = await bridge.sendAddJetton(admin.getSender(), {
            coinId: jettonCoinId,
            data: metadata,
        });

        expect(res.transactions).toHaveTransaction({
            from: bridge.address,
            to: expectedMinterAddress,
            deploy: true,
            success: true,
        });

        const bridgeData = await bridge.getBridgeData();

        expect(bridgeData.jettons.has(jettonCoinId)).toBeTruthy();
        expect(bridgeData.jettons.get(jettonCoinId)?.toString()).toEqual(expectedMinterAddress.toString());
    });

    it('should fail to add new jetton because of non admin account', async () => {
        const res = await bridge.sendAddJetton(user.getSender(), {
            coinId: jettonCoinId,
            data: metadata,
        });

        expect(res.transactions).toHaveTransaction({
            from: user.address,
            to: bridge.address,
            success: false,
            exitCode: 403,
        });
    });

    it('should mint jetton to destination address', async () => {
        const res = await bridge.sendMintJetton(oracle.getSender(), {
            value: toNano('0.5'),
            address: user.address,
            coinId: jettonCoinId,
            amount: toNano('2.0'),
            forwardAmount: toNano('0.1'),
        });

        const minterAddress = JettonMinter.calculateAddress(0, bridge.address, metadata);
        const expectedWalletAddress = JettonWallet.calculateAddress(user.address, minterAddress);

        expect(res.transactions).not.toHaveTransaction({
            success: false,
        });

        expect(res.transactions).toHaveTransaction({
            from: bridge.address,
            to: minterAddress,
            success: true,
        });

        expect(res.transactions).toHaveTransaction({
            from: minterAddress,
            to: expectedWalletAddress,
            success: true,
        });
    });

    it('should burn jetton and emit log message', async () => {
        const destinationAddress = 0x142d6db735cdb50bfc6ec65f94830320c6c7a245n;
        const burnValue = toNano('1.0');

        const minterAddress = JettonMinter.calculateAddress(0, bridge.address, metadata);

        const jWalletAddress = await bridge.getJettonWalletAddress(jettonCoinId, user.address);
        const jettonWallet = blockchain.openContract(JettonWallet.createFromAddress(jWalletAddress));

        const res = await jettonWallet.sendBurn(user.getSender(), {
            amount: burnValue,
            coinId: jettonCoinId,
            destAddr: destinationAddress,
        });

        expect(res.transactions).not.toHaveTransaction({
            success: false,
        });

        const resp = res.transactions[res.transactions.length - 1].outMessages;
        const cs = resp.get(0)?.body.beginParse()!;

        const logDestinationAddress = cs.loadUintBig(160).toString(16);
        const logJettonCoinId = cs.loadUint(32);
        const logFromAddressHash = cs.loadUintBig(256).toString(16);
        const logFromAddress = Address.parseRaw(bridge.address.workChain + ':' + logFromAddressHash);
        const logMsgValue = cs.loadCoins();

        expect(logDestinationAddress).toEqual(destinationAddress.toString(16));
        expect(logJettonCoinId).toEqual(jettonCoinId);
        expect(logFromAddress.equals(user.address)).toBeTruthy;
        expect(logMsgValue).toEqual(burnValue);
    });
});
